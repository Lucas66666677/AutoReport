import base64
import html
import io
import logging
import re
import tempfile
import traceback
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt

def _configure_matplotlib_cjk() -> None:
    """Matplotlib 圖表標題/軸標籤中文防豆腐塊（每次 exec 前也會重設）。"""
    plt.rcParams["font.sans-serif"] = ["Microsoft JhengHei", "SimHei", "Arial"]
    plt.rcParams["axes.unicode_minus"] = False


_configure_matplotlib_cjk()

import numpy as np
import pypandoc
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="AutoLabReport API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PYTHON_BLOCK_RE = re.compile(r"```python\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


class RenderRequest(BaseModel):
    markdown: str


class RenderResponse(BaseModel):
    markdown: str


def _noop_show(*_args: Any, **_kwargs: Any) -> None:
    """讓 plt.show() 在伺服器上安全通過，不彈窗、不阻塞。"""
    return None


def _run_python_code(code: str) -> tuple[list[plt.Figure], str | None]:
    _configure_matplotlib_cjk()
    plt.close("all")
    plt.clf()

    original_show = plt.show
    plt.show = _noop_show

    namespace: dict[str, Any] = {
        "__builtins__": __builtins__,
        "np": np,
        "plt": plt,
    }

    try:
        exec(code, namespace)
    except Exception as exc:
        return [], str(exc)
    finally:
        plt.show = original_show

    figures: list[plt.Figure] = []
    for fig_num in list(plt.get_fignums()):
        fig = plt.figure(fig_num)
        if fig.get_axes():
            figures.append(fig)
        else:
            plt.close(fig)

    return figures, None


def _close_figures(figures: list[plt.Figure]) -> None:
    for fig in figures:
        plt.close(fig)


def _figure_to_img_tag(fig: plt.Figure) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=120)
    encoded_str = base64.b64encode(buf.getvalue()).decode("utf-8")
    return (
        f'<img src="data:image/png;base64,{encoded_str}" '
        'alt="matplotlib plot" />'
    )


def _execute_python_block_for_render(code: str) -> str:
    figures, error = _run_python_code(code)
    if error:
        return f'<p style="color:#f87171;">Python 執行錯誤：{html.escape(error)}</p>'

    try:
        if not figures:
            return "<p><em>（程式碼已執行，未產生圖表）</em></p>"
        return "\n\n".join(_figure_to_img_tag(fig) for fig in figures)
    finally:
        _close_figures(figures)


def _execute_python_block_for_export(
    code: str, assets_dir: Path, plot_counter: list[int]
) -> str:
    figures, error = _run_python_code(code)
    if error:
        return f"*Python 執行錯誤：{error}*"

    try:
        if not figures:
            return "*（程式碼已執行，未產生圖表）*"

        md_parts: list[str] = []
        for fig in figures:
            plot_counter[0] += 1
            filename = f"plot_{plot_counter[0]}.png"
            image_path = assets_dir / filename
            fig.savefig(
                image_path,
                format="png",
                bbox_inches="tight",
                dpi=120,
            )
            # Pandoc on Windows 需要正斜線的絕對路徑才能穩定找到圖片
            image_ref = image_path.resolve().as_posix()
            md_parts.append(f"![圖表]({image_ref})")
        return "\n\n".join(md_parts)
    finally:
        _close_figures(figures)


def render_markdown(text: str) -> str:
    def replace_block(match: re.Match[str]) -> str:
        code = match.group(1).strip("\n")
        return _execute_python_block_for_render(code)

    return PYTHON_BLOCK_RE.sub(replace_block, text)


def _process_markdown_for_file_export(text: str, assets_dir: Path) -> str:
    plot_counter = [0]

    def replace_block(match: re.Match[str]) -> str:
        code = match.group(1).strip("\n")
        return _execute_python_block_for_export(code, assets_dir, plot_counter)

    return PYTHON_BLOCK_RE.sub(replace_block, text)


def export_markdown_to_docx(text: str) -> bytes:
    try:
        with tempfile.TemporaryDirectory() as tmp:
            assets_dir = Path(tmp)
            processed = _process_markdown_for_file_export(text, assets_dir)
            md_file = assets_dir / "report.md"
            docx_file = assets_dir / "AutoLabReport.docx"

            md_file.write_text(processed, encoding="utf-8")

            try:
                # convert_text + encoding=utf-8 避免 Windows cp950 讀檔錯誤
                pypandoc.convert_text(
                    processed,
                    "docx",
                    format="md",
                    outputfile=str(docx_file),
                    encoding="utf-8",
                )
            except OSError as exc:
                traceback.print_exc()
                logger.exception("Pandoc 執行失敗（可能未安裝或不在 PATH）")
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Pandoc 未安裝或無法執行。請先安裝 Pandoc 並加入 PATH："
                        "https://pandoc.org/installing.html"
                        f"（{type(exc).__name__}: {exc}）"
                    ),
                ) from exc
            except RuntimeError as exc:
                traceback.print_exc()
                logger.exception("pypandoc 轉換 Word 失敗")
                raise HTTPException(
                    status_code=500,
                    detail=f"Word 匯出失敗（Pandoc）：{exc}",
                ) from exc

            if not docx_file.is_file():
                raise HTTPException(
                    status_code=500,
                    detail="Word 匯出失敗：Pandoc 未產生 .docx 檔案。",
                )

            return docx_file.read_bytes()
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        logger.exception("Word 匯出流程發生未預期錯誤")
        raise HTTPException(
            status_code=500,
            detail=f"Word 匯出失敗：{type(exc).__name__}: {exc}",
        ) from exc


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "AutoLabReport API"}


@app.post("/api/render", response_model=RenderResponse)
def render(body: RenderRequest):
    return RenderResponse(markdown=render_markdown(body.markdown))


@app.post("/api/export")
def export_docx(body: RenderRequest):
    try:
        docx_bytes = export_markdown_to_docx(body.markdown)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        logger.exception("/api/export 未處理的錯誤")
        raise HTTPException(
            status_code=500,
            detail=f"Word 匯出失敗：{type(exc).__name__}: {exc}",
        ) from exc

    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type=(
            "application/vnd.openxmlformats-officedocument"
            ".wordprocessingml.document"
        ),
        headers={
            "Content-Disposition": 'attachment; filename="AutoLabReport.docx"',
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
