import base64
import html
import io
import json
import logging
import os
import re
import tempfile
import traceback
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

logger = logging.getLogger(__name__)

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt

def _configure_matplotlib_cjk() -> None:
    """Matplotlib 圖表標題/軸標籤中文防豆腐塊（每次 exec 前也會重設）。"""
    plt.rcParams["font.sans-serif"] = ["Microsoft JhengHei", "SimHei", "Arial"]
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["text.usetex"] = False
    plt.rcParams["mathtext.fontset"] = "cm"


_configure_matplotlib_cjk()

import numpy as np
import pypandoc
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    import scipy
except ImportError:
    scipy = None

app = FastAPI(title="AutoLabReport API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
FREE_DAILY_AI_QUOTA = int(os.getenv("FREE_DAILY_AI_QUOTA", "3"))
PRO_DAILY_AI_QUOTA = int(os.getenv("PRO_DAILY_AI_QUOTA", "300"))
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_PRO_PRICE_ID = os.getenv("STRIPE_PRO_PRICE_ID")
STRIPE_CUSTOMER_PORTAL_URL = os.getenv("STRIPE_CUSTOMER_PORTAL_URL")

PYTHON_BLOCK_RE = re.compile(r"```python\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


class RenderRequest(BaseModel):
    markdown: str


class RenderResponse(BaseModel):
    markdown: str


class OutlineRequest(BaseModel):
    sample_structure: str


class OutlineResponse(BaseModel):
    markdown: str


class AiRunRequest(BaseModel):
    provider: Literal["built_in", "extension", "user_api_key"] = "built_in"
    action: Literal["outline", "rewrite", "expand", "format", "summarize", "custom"]
    text: str
    document_id: str | None = None
    prompt: str | None = None
    api_provider: Literal["openai", "gemini", "anthropic", "deepseek", "none"] | None = None
    api_key: str | None = None
    model: str | None = None


class AiRunResponse(BaseModel):
    markdown: str
    provider: str
    model: str | None = None
    remaining_quota: int | None = None


AgentMode = Literal[
    "review",
    "complete_section",
    "format",
    "chart",
    "final_check",
    "multi_step",
]


class AgentRunRequest(BaseModel):
    provider: Literal["built_in", "user_api_key"] = "built_in"
    mode: AgentMode
    goal: str = ""
    document_markdown: str
    selected_text: str | None = None
    document_id: str | None = None
    api_provider: Literal["openai", "gemini", "anthropic", "deepseek", "none"] | None = None
    api_key: str | None = None
    model: str | None = None


class AgentChecklistItem(BaseModel):
    label: str
    status: Literal["pass", "warn", "fail"]
    note: str


class AgentRunResponse(BaseModel):
    mode: AgentMode
    title: str
    plan: list[str]
    findings: list[str]
    checklist: list[AgentChecklistItem]
    questions: list[str]
    proposed_markdown: str | None = None
    patch_summary: str | None = None
    model: str | None = None
    remaining_quota: int | None = None


class BillingConfigResponse(BaseModel):
    enabled: bool
    pro_price_id_configured: bool
    customer_portal_url: str | None = None
    message: str


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
    if scipy is not None:
        namespace["scipy"] = scipy

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


def _extract_outline_headings(sample_structure: str) -> list[tuple[int, str]]:
    headings: list[tuple[int, str]] = []

    for raw_line in sample_structure.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        markdown_match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if markdown_match:
            headings.append((len(markdown_match.group(1)), markdown_match.group(2).strip()))
            continue

        numbered_match = re.match(r"^(?:\d+(?:\.\d+)*[.)、]?\s*)(.+)$", line)
        if numbered_match:
            title = numbered_match.group(1).strip()
            level = 2 if "." not in line.split(maxsplit=1)[0] else 3
            headings.append((level, title))

    return headings


def generate_outline_from_sample(sample_structure: str) -> str:
    headings = _extract_outline_headings(sample_structure)
    if not headings:
        headings = [
            (1, "實驗報告"),
            (2, "實驗目的"),
            (2, "實驗原理"),
            (2, "實驗材料與方法"),
            (2, "實驗數據與結果"),
            (2, "討論"),
            (2, "結論"),
            (2, "參考資料"),
        ]

    sections: list[str] = []
    for level, title in headings:
        safe_level = max(1, min(level, 6))
        sections.append(f"{'#' * safe_level} {title}")
        if safe_level == 1:
            sections.append("")
            sections.append("- 課程/實驗名稱：")
            sections.append("- 姓名：")
            sections.append("- 日期：")
        else:
            sections.append("")
            sections.append("> 請在此填入內容。")
        sections.append("")

    return "\n".join(sections).strip() + "\n"


def _fallback_ai_response(action: str, text: str) -> str:
    cleaned = text.strip()
    if action == "outline":
        return generate_outline_from_sample(cleaned)

    if action == "format":
        return re.sub(r"\n{3,}", "\n\n", cleaned).strip() + "\n"

    if action == "summarize":
        preview = re.sub(r"\s+", " ", cleaned)[:600]
        return f"## 結論\n\n{preview}\n"

    if action == "expand":
        return (
            f"{cleaned}\n\n"
            "補充說明：此段可進一步加入實驗條件、觀察結果、誤差來源與理論依據，"
            "使論述更符合正式實驗報告的學術脈絡。\n"
        )

    # rewrite/custom fallback: conservative text cleanup
    formatted = (
        cleaned.replace(" ,", ",")
        .replace(" .", ".")
        .replace(" ，", "，")
        .replace(" 。", "。")
    )
    return re.sub(r"\n{3,}", "\n\n", formatted).strip() + "\n"


def _post_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"AI provider error: {detail}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"AI provider unavailable: {exc}") from exc


def _supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _supabase_request(
    path: str,
    method: str = "GET",
    payload: Any | None = None,
    extra_headers: dict[str, str] | None = None,
) -> Any:
    if not _supabase_configured():
        raise HTTPException(status_code=503, detail="Supabase service role 尚未設定")

    assert SUPABASE_URL is not None
    assert SUPABASE_SERVICE_ROLE_KEY is not None

    url = f"{SUPABASE_URL.rstrip('/')}{path}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        **(extra_headers or {}),
    }
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Supabase error: {detail}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Supabase unavailable: {exc}") from exc


def _get_user_from_authorization(authorization: str | None) -> dict[str, Any] | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    if not _supabase_configured():
        return None

    token = authorization.split(" ", 1)[1].strip()
    assert SUPABASE_URL is not None
    assert SUPABASE_SERVICE_ROLE_KEY is not None

    request = urllib.request.Request(
        f"{SUPABASE_URL.rstrip('/')}/auth/v1/user",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {token}",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        return None


def _today_iso() -> str:
    return datetime.now(UTC).date().isoformat()


def _parse_date(value: str | None) -> str | None:
    if not value:
        return None
    return value[:10]


def _get_or_create_profile(user: dict[str, Any]) -> dict[str, Any]:
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="無效的使用者")

    rows = _supabase_request(f"/rest/v1/profiles?id=eq.{user_id}&select=*")
    if rows:
        return rows[0]

    metadata = user.get("user_metadata") or {}
    email = user.get("email")
    payload = {
        "id": user_id,
        "email": email,
        "full_name": metadata.get("full_name") or metadata.get("name"),
        "avatar_url": metadata.get("avatar_url"),
        "plan": "free",
        "ai_daily_used": 0,
        "ai_daily_reset_at": datetime.now(UTC).isoformat(),
    }
    rows = _supabase_request(
        "/rest/v1/profiles",
        method="POST",
        payload=payload,
        extra_headers={"Prefer": "return=representation"},
    )
    return rows[0]


def _reset_profile_quota_if_needed(profile: dict[str, Any]) -> dict[str, Any]:
    reset_date = _parse_date(profile.get("ai_daily_reset_at"))
    if reset_date == _today_iso():
        return profile

    profile_id = profile["id"]
    rows = _supabase_request(
        f"/rest/v1/profiles?id=eq.{profile_id}",
        method="PATCH",
        payload={
            "ai_daily_used": 0,
            "ai_daily_reset_at": datetime.now(UTC).isoformat(),
        },
        extra_headers={"Prefer": "return=representation"},
    )
    return rows[0]


def _quota_limit_for_plan(plan: str | None) -> int:
    return PRO_DAILY_AI_QUOTA if plan == "pro" else FREE_DAILY_AI_QUOTA


def _get_ai_quota(user: dict[str, Any]) -> dict[str, Any]:
    profile = _reset_profile_quota_if_needed(_get_or_create_profile(user))
    limit = _quota_limit_for_plan(profile.get("plan"))
    used = int(profile.get("ai_daily_used") or 0)
    return {
        "plan": profile.get("plan") or "free",
        "used": used,
        "limit": limit,
        "remaining": max(limit - used, 0),
    }


def _consume_ai_quota(user: dict[str, Any]) -> dict[str, Any]:
    quota = _get_ai_quota(user)
    if quota["remaining"] <= 0:
        raise HTTPException(status_code=402, detail="今日內建 AI 免費額度已用完")

    next_used = quota["used"] + 1
    _supabase_request(
        f"/rest/v1/profiles?id=eq.{user['id']}",
        method="PATCH",
        payload={"ai_daily_used": next_used},
    )
    quota["used"] = next_used
    quota["remaining"] = max(quota["limit"] - next_used, 0)
    return quota


def _log_ai_usage(
    user: dict[str, Any] | None,
    body: AiRunRequest,
    model: str | None,
    status: str,
) -> None:
    if not _supabase_configured():
        return

    try:
        _supabase_request(
            "/rest/v1/ai_usage_logs",
            method="POST",
            payload={
                "user_id": user.get("id") if user else None,
                "provider": body.provider,
                "action": body.action,
                "model": model,
                "input_tokens": max(len(body.text) // 4, 1),
                "output_tokens": 0,
                "status": status,
            },
        )
    except Exception:
        logger.exception("AI usage log 寫入失敗")


def _run_openai_compatible(
    api_key: str,
    prompt: str,
    model: str,
    base_url: str = "https://api.openai.com/v1/chat/completions",
) -> str:
    result = _post_json(
        base_url,
        {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are AutoLabReport's academic Markdown writing assistant.",
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.4,
        },
    )
    return result["choices"][0]["message"]["content"].strip()


def _run_gemini(api_key: str, prompt: str, model: str) -> str:
    result = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
        {"Content-Type": "application/json"},
        {"contents": [{"parts": [{"text": prompt}]}]},
    )
    return result["candidates"][0]["content"]["parts"][0]["text"].strip()


def _run_anthropic(api_key: str, prompt: str, model: str) -> str:
    result = _post_json(
        "https://api.anthropic.com/v1/messages",
        {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        {
            "model": model,
            "max_tokens": 1800,
            "messages": [{"role": "user", "content": prompt}],
        },
    )
    return result["content"][0]["text"].strip()


def _run_ai_provider(body: AiRunRequest) -> tuple[str, str | None]:
    prompt = body.prompt or body.text
    provider = body.api_provider or "none"

    if body.provider == "built_in":
        built_in_key = os.getenv("AUTOLABREPORT_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
        if built_in_key:
            model = body.model or os.getenv("AUTOLABREPORT_OPENAI_MODEL", "gpt-4o-mini")
            return _run_openai_compatible(built_in_key, prompt, model), model
        return _fallback_ai_response(body.action, body.text), "fallback-rule"

    if body.provider == "user_api_key":
        if not body.api_key or provider == "none":
            raise HTTPException(status_code=400, detail="請先提供 API provider 與 API key")

        if provider == "openai":
            model = body.model or "gpt-4o-mini"
            return _run_openai_compatible(body.api_key, prompt, model), model
        if provider == "deepseek":
            model = body.model or "deepseek-chat"
            return (
                _run_openai_compatible(
                    body.api_key,
                    prompt,
                    model,
                    "https://api.deepseek.com/chat/completions",
                ),
                model,
            )
        if provider == "gemini":
            model = body.model or "gemini-1.5-flash"
            return _run_gemini(body.api_key, prompt, model), model
        if provider == "anthropic":
            model = body.model or "claude-3-5-haiku-latest"
            return _run_anthropic(body.api_key, prompt, model), model

    raise HTTPException(status_code=400, detail="不支援的 AI provider")


AGENT_MODE_LABELS: dict[str, str] = {
    "review": "報告審閱 Agent",
    "complete_section": "報告補全 Agent",
    "format": "格式整理 Agent",
    "chart": "圖表 Agent",
    "final_check": "提交前檢查 Agent",
    "multi_step": "多步寫作 Agent",
}


def _extract_markdown_headings(markdown: str) -> list[str]:
    return re.findall(r"^#{1,6}\s+(.+)$", markdown, flags=re.MULTILINE)


def _has_markdown_table(markdown: str) -> bool:
    return bool(re.search(r"^\|.+\|\s*\n\|[\s:|-]+\|", markdown, flags=re.MULTILINE))


def _has_python_block(markdown: str) -> bool:
    return bool(PYTHON_BLOCK_RE.search(markdown))


def _basic_report_checklist(markdown: str) -> list[dict[str, str]]:
    headings_text = "\n".join(_extract_markdown_headings(markdown)).lower()
    checks = [
        ("摘要/概述", ["摘要", "abstract", "概述"]),
        ("實驗目的", ["目的"]),
        ("實驗原理", ["原理", "理論", "background"]),
        ("實驗方法/步驟", ["方法", "步驟", "procedure", "method"]),
        ("數據/結果", ["數據", "資料", "結果", "data", "result"]),
        ("討論/誤差", ["討論", "誤差", "不確定度", "discussion", "error"]),
        ("結論", ["結論", "conclusion"]),
        ("參考資料", ["參考", "reference"]),
    ]
    items: list[dict[str, str]] = []
    for label, keywords in checks:
        ok = any(keyword.lower() in headings_text for keyword in keywords)
        items.append(
            {
                "label": label,
                "status": "pass" if ok else "fail",
                "note": "已找到相關章節。" if ok else "未找到明確章節，建議補上或改成清楚標題。",
            }
        )

    table_ok = _has_markdown_table(markdown)
    items.append(
        {
            "label": "表格資料",
            "status": "pass" if table_ok else "warn",
            "note": "已偵測到 Markdown 表格。" if table_ok else "未偵測到表格；若有量測資料，建議用表格整理。",
        }
    )
    return items


def _normalize_agent_payload(raw: dict[str, Any], mode: AgentMode) -> AgentRunResponse:
    def string_list(name: str) -> list[str]:
        value = raw.get(name)
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()][:12]

    checklist: list[AgentChecklistItem] = []
    for item in raw.get("checklist") or []:
        if not isinstance(item, dict):
            continue
        status = item.get("status")
        if status not in {"pass", "warn", "fail"}:
            status = "warn"
        checklist.append(
            AgentChecklistItem(
                label=str(item.get("label") or "檢查項目").strip(),
                status=status,
                note=str(item.get("note") or "").strip(),
            )
        )

    proposed = raw.get("proposed_markdown")
    if not isinstance(proposed, str) or not proposed.strip():
        proposed = None

    return AgentRunResponse(
        mode=mode,
        title=str(raw.get("title") or AGENT_MODE_LABELS[mode]).strip(),
        plan=string_list("plan"),
        findings=string_list("findings"),
        checklist=checklist,
        questions=string_list("questions"),
        proposed_markdown=proposed,
        patch_summary=str(raw.get("patch_summary") or "").strip() or None,
    )


def _parse_agent_json(text: str, mode: AgentMode) -> AgentRunResponse:
    cleaned = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, flags=re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    else:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            cleaned = cleaned[start : end + 1]

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"Agent 回傳不是有效 JSON：{exc}") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="Agent 回傳格式錯誤")
    return _normalize_agent_payload(parsed, mode)


def _format_markdown_rules(markdown: str) -> str:
    formatted = markdown.replace("\r\n", "\n").replace("\r", "\n")
    formatted = re.sub(r"[ \t]+$", "", formatted, flags=re.MULTILINE)
    formatted = re.sub(r"\n{3,}", "\n\n", formatted)
    formatted = re.sub(r"^(#{1,6})([^\s#])", r"\1 \2", formatted, flags=re.MULTILINE)
    formatted = apply_table_spacing(formatted)
    return formatted.strip() + "\n"


def apply_table_spacing(markdown: str) -> str:
    lines = markdown.splitlines()
    next_lines: list[str] = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            next_lines.append("| " + " | ".join(cells) + " |")
            continue
        next_lines.append(line)
    return "\n".join(next_lines)


def _chart_snippet_from_document(markdown: str) -> str:
    return (
        "\n\n## 圖表分析\n\n"
        "```python\n"
        "import numpy as np\n"
        "import matplotlib.pyplot as plt\n\n"
        "# TODO: 將表格中的量測資料填入 x 與 y\n"
        "x = np.array([1, 2, 3, 4])\n"
        "y = np.array([0.9, 2.1, 2.9, 4.2])\n\n"
        "coef = np.polyfit(x, y, 1)\n"
        "fit = np.poly1d(coef)\n\n"
        "plt.figure(figsize=(6, 4))\n"
        "plt.scatter(x, y, label='量測值')\n"
        "plt.plot(x, fit(x), label=f'線性擬合: y={coef[0]:.3f}x+{coef[1]:.3f}')\n"
        "plt.xlabel('自變量')\n"
        "plt.ylabel('應變量')\n"
        "plt.title('量測資料與線性擬合')\n"
        "plt.grid(True, alpha=0.3)\n"
        "plt.legend()\n"
        "plt.show()\n"
        "```\n"
    )


def _fallback_agent_response(body: AgentRunRequest) -> AgentRunResponse:
    markdown = body.document_markdown.strip()
    selected = (body.selected_text or "").strip()
    checklist = [
        AgentChecklistItem(**item) for item in _basic_report_checklist(markdown)
    ]
    findings = [
        item.note for item in checklist if item.status in {"warn", "fail"}
    ][:8]
    if not findings:
        findings = ["整體章節已具備基礎完整度，下一步可加強數據解釋、誤差來源與結論收束。"]

    title = AGENT_MODE_LABELS[body.mode]
    proposed: str | None = None
    patch_summary: str | None = None
    questions: list[str] = []

    if body.mode == "format":
        proposed = _format_markdown_rules(markdown)
        patch_summary = "已用規則整理標題空格、表格空白與多餘空行。"
    elif body.mode == "chart":
        proposed = markdown + _chart_snippet_from_document(markdown)
        patch_summary = "已在文件末尾加入可執行的 Python 圖表區塊，請把示例 x/y 換成真實資料。"
        if not _has_markdown_table(markdown):
            findings.insert(0, "目前未偵測到 Markdown 表格，圖表程式先使用示例資料。")
    elif body.mode == "complete_section":
        source = selected or "目前章節"
        addition = (
            f"\n\n### 補充分析草稿\n\n"
            f"根據{source[:40]}的內容，建議補上量測條件、主要趨勢、誤差來源與理論值比較。"
            "請將具體數據填入後，再把此段調整為正式結果分析。\n"
        )
        proposed = markdown + addition
        patch_summary = "已加入結果分析草稿，保留待填數據位置。"
        questions = ["有哪些原始量測值、理論值或老師指定要討論的誤差項？"]
    elif body.mode == "multi_step":
        proposed = markdown
        missing_sections = [item.label for item in checklist if item.status == "fail"]
        if missing_sections:
            proposed += "\n\n## 待補章節\n\n" + "\n".join(f"- {item}" for item in missing_sections) + "\n"
        patch_summary = "已根據缺失章節建立多步寫作待辦。"
        questions = [
            "這份報告的實驗題目、課程名稱和提交格式是什麼？",
            "是否有原始數據表、老師 rubric 或範例報告？",
        ]
    elif body.mode == "review":
        questions = ["是否要我下一步直接把 fail/warn 項目改成可提交草稿？"]
    elif body.mode == "final_check":
        questions = ["是否已確認數據、公式、圖片來源和參考資料格式符合老師要求？"]

    return AgentRunResponse(
        mode=body.mode,
        title=title,
        plan=[
            "讀取目前 Markdown 全文與選取文字。",
            "檢查章節、表格、公式、圖表與提交完整度。",
            "輸出可確認的建議，必要時提供可套用 Markdown。",
        ],
        findings=findings,
        checklist=checklist,
        questions=questions,
        proposed_markdown=proposed,
        patch_summary=patch_summary,
        model="fallback-agent-rule",
    )


def _build_agent_prompt(body: AgentRunRequest) -> str:
    mode_instructions = {
        "review": "審閱全文，找出結構缺失、語氣不學術、結論太弱、數據表缺標題、公式沒解釋、圖表沒編號等問題。除非非常必要，不要改全文。",
        "complete_section": "根據全文上下文與選取內容，只補全使用者指定或最可能缺失的章節，避免重寫無關段落。",
        "format": "整理 Markdown 格式：標題層級、圖表編號、表格格式、空行、單位寫法與學術語氣。可回傳完整整理後 Markdown。",
        "chart": "根據文件中的表格或數據，建議合適圖表，並插入可執行 Python code block。若資料不足，使用 TODO 和示例資料。",
        "final_check": "做提交前 checklist，檢查摘要、目的、原理、方法、數據、討論、結論、參考資料是否完整。",
        "multi_step": "面對籠統目標時，先計畫、列缺失資料問題，再提供分階段可執行草稿。不要假造未知數據。",
    }
    output_schema = {
        "title": "短標題",
        "plan": ["步驟 1", "步驟 2"],
        "findings": ["具體問題或建議"],
        "checklist": [
            {"label": "檢查項", "status": "pass|warn|fail", "note": "原因"}
        ],
        "questions": ["需要使用者補充的問題"],
        "proposed_markdown": "可選；如果要修改文件，回傳完整 Markdown；不修改則為空字串",
        "patch_summary": "可選；摘要本次建議修改",
    }
    return (
        "你是 AutoLabReport 的 STEM 實驗報告 Agent。"
        "只回傳有效 JSON，不要 markdown code fence，不要額外解釋。\n\n"
        f"Agent 模式：{body.mode} - {mode_instructions[body.mode]}\n"
        f"使用者目標：{body.goal or '未提供，請根據模式處理'}\n"
        f"選取文字：\n{body.selected_text or ''}\n\n"
        f"目前文件 Markdown：\n{body.document_markdown}\n\n"
        f"JSON schema 範例：{json.dumps(output_schema, ensure_ascii=False)}"
    )


def _run_agent_provider(body: AgentRunRequest) -> tuple[AgentRunResponse, str | None]:
    prompt = _build_agent_prompt(body)
    ai_body = AiRunRequest(
        provider=body.provider,
        action="custom",
        text=body.document_markdown,
        prompt=prompt,
        api_provider=body.api_provider,
        api_key=body.api_key,
        model=body.model,
    )
    text, model = _run_ai_provider(ai_body)
    response = _parse_agent_json(text, body.mode)
    response.model = model
    return response, model


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "AutoLabReport API"}


@app.get("/keep-alive")
def keep_alive():
    return {"status": "I am awake!", "message": "Render 伺服器保活中"}


@app.post("/api/render", response_model=RenderResponse)
def render(body: RenderRequest):
    return RenderResponse(markdown=render_markdown(body.markdown))


@app.post("/api/generate-outline", response_model=OutlineResponse)
def generate_outline(body: OutlineRequest):
    return OutlineResponse(markdown=generate_outline_from_sample(body.sample_structure))


@app.post("/api/ai/run", response_model=AiRunResponse)
def run_ai(body: AiRunRequest, authorization: str | None = Header(default=None)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="請提供要處理的文字")

    user = _get_user_from_authorization(authorization)
    quota: dict[str, Any] | None = None
    model: str | None = None
    try:
        if body.provider == "built_in":
            if user is None:
                raise HTTPException(status_code=401, detail="內建 AI 需要登入後使用")
            quota = _get_ai_quota(user)
            if quota["remaining"] <= 0:
                raise HTTPException(status_code=402, detail="今日內建 AI 免費額度已用完")

        markdown, model = _run_ai_provider(body)
        if body.provider == "built_in" and user is not None:
            quota = _consume_ai_quota(user)
        _log_ai_usage(user, body, model, "success")
    except HTTPException:
        _log_ai_usage(user, body, model, "error")
        raise

    return AiRunResponse(
        markdown=markdown,
        provider=body.provider,
        model=model,
        remaining_quota=quota["remaining"] if quota else None,
    )


@app.get("/api/ai/quota")
def get_ai_quota(authorization: str | None = Header(default=None)):
    user = _get_user_from_authorization(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="請先登入")
    return _get_ai_quota(user)


@app.post("/api/agent/run", response_model=AgentRunResponse)
def run_agent(body: AgentRunRequest, authorization: str | None = Header(default=None)):
    markdown = body.document_markdown.strip()
    if not markdown:
        raise HTTPException(status_code=400, detail="請先提供目前文件內容")

    user = _get_user_from_authorization(authorization)
    quota: dict[str, Any] | None = None
    model: str | None = None

    try:
        if body.provider == "built_in":
            if user is None:
                raise HTTPException(status_code=401, detail="Agent 需要登入後使用內建 AI")
            quota = _get_ai_quota(user)
            if quota["remaining"] <= 0:
                raise HTTPException(status_code=402, detail="今日內建 AI 免費額度已用完")

        has_llm_key = (
            body.provider == "user_api_key"
            and bool(body.api_key)
            and body.api_provider not in {None, "none"}
        ) or (
            body.provider == "built_in"
            and bool(os.getenv("AUTOLABREPORT_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY"))
        )

        if has_llm_key:
            response, model = _run_agent_provider(body)
        else:
            response = _fallback_agent_response(body)
            model = response.model

        if body.provider == "built_in" and user is not None:
            quota = _consume_ai_quota(user)

        response.remaining_quota = quota["remaining"] if quota else None
        response.model = model
        return response
    except HTTPException:
        raise


@app.get("/api/billing/config", response_model=BillingConfigResponse)
def get_billing_config():
    enabled = bool(STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID)
    return BillingConfigResponse(
        enabled=enabled,
        pro_price_id_configured=bool(STRIPE_PRO_PRICE_ID),
        customer_portal_url=STRIPE_CUSTOMER_PORTAL_URL,
        message="Stripe 已可接入" if enabled else "Stripe 尚未設定，請先配置 STRIPE_SECRET_KEY 與 STRIPE_PRO_PRICE_ID",
    )


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
