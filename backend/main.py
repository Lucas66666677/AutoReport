import base64
from collections import Counter
from decimal import Decimal, InvalidOperation
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import tempfile
import urllib.error
import urllib.request
import urllib.parse
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

logger = logging.getLogger(__name__)

import stripe
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from openai import OpenAI
import pypandoc
from pypdf import PdfReader
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field

app = FastAPI(title="AutoLabReport API", version="0.4.0")

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

load_dotenv(Path(__file__).with_name(".env"))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
FREE_DAILY_AI_QUOTA = int(os.getenv("FREE_DAILY_AI_QUOTA", "3"))
PRO_DAILY_AI_QUOTA = int(os.getenv("PRO_DAILY_AI_QUOTA", "300"))
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_PRO_PRICE_ID = os.getenv("STRIPE_PRO_PRICE_ID")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
GITHUB_OAUTH_STATE_SECRET = os.getenv("GITHUB_OAUTH_STATE_SECRET") or ENCRYPTION_KEY
OWNERSHIP_TRANSFER_EMAIL_CONFIGURED = os.getenv("OWNERSHIP_TRANSFER_EMAIL_CONFIGURED") == "true"
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

# Built-in AI dual engine configuration. Put these in backend/.env locally
# or in your production backend environment variables:
# GROQ_API_KEY=...
# GROQ_MODEL=llama-3.3-70b-versatile
# GROQ_MODELS=llama-3.3-70b-versatile,llama-3.1-8b-instant
# GEMINI_API_KEY=...
# GEMINI_MODEL=gemini-2.0-flash
# GEMINI_MODELS=gemini-2.0-flash,gemini-1.5-flash
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

GITHUB_SYNC_ENABLED = os.getenv("GITHUB_SYNC_ENABLED") == "true"
STRIPE_BILLING_ENABLED = os.getenv("STRIPE_BILLING_ENABLED") == "true"
GOOGLE_DRIVE_ENABLED = os.getenv("GOOGLE_DRIVE_ENABLED") == "true"


def _parse_model_list(*values: str | None, default: str) -> list[str]:
    models: list[str] = []
    for value in values:
        if not value:
            continue
        for item in re.split(r"[,;\s]+", value):
            model = item.strip()
            if model and model not in models:
                models.append(model)
    return models or [default]


GROQ_MODELS = _parse_model_list(
    os.getenv("GROQ_MODEL"),
    os.getenv("GROQ_MODELS"),
    os.getenv("GROQ_FALLBACK_MODELS"),
    default="llama-3.3-70b-versatile",
)
GEMINI_MODELS = _parse_model_list(
    os.getenv("GEMINI_MODEL"),
    os.getenv("GEMINI_MODELS"),
    os.getenv("GEMINI_FALLBACK_MODELS"),
    default="gemini-2.0-flash",
)

groq_client = (
    OpenAI(
        api_key=GROQ_API_KEY,
        base_url="https://api.groq.com/openai/v1",
        timeout=45,
    )
    if GROQ_API_KEY
    else None
)
gemini_client = (
    OpenAI(
        api_key=GEMINI_API_KEY,
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        timeout=45,
    )
    if GEMINI_API_KEY
    else None
)

PYTHON_BLOCK_RE = re.compile(r"```python\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


class RenderRequest(BaseModel):
    markdown: str = Field(max_length=2_000_000)


class RenderResponse(BaseModel):
    markdown: str


class OutlineRequest(BaseModel):
    sample_structure: str = Field(max_length=100_000)


class OutlineResponse(BaseModel):
    markdown: str


class AiRunRequest(BaseModel):
    provider: Literal["built_in", "extension", "user_api_key"] = "built_in"
    action: Literal["outline", "rewrite", "expand", "format", "summarize", "custom"]
    text: str = Field(max_length=200_000)
    document_id: str | None = None
    prompt: str | None = Field(default=None, max_length=300_000)
    api_provider: Literal["openai", "gemini", "anthropic", "deepseek", "none"] | None = None
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
    goal: str = Field(default="", max_length=10_000)
    document_markdown: str = Field(max_length=500_000)
    selected_text: str | None = Field(default=None, max_length=200_000)
    document_id: str | None = None
    api_provider: Literal["openai", "gemini", "anthropic", "deepseek", "none"] | None = None
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


class StripeSessionRequest(BaseModel):
    success_url: str | None = None
    cancel_url: str | None = None
    return_url: str | None = None


class StripeSessionResponse(BaseModel):
    url: str


class SaveApiKeyRequest(BaseModel):
    api_provider: Literal["openai", "gemini", "anthropic", "deepseek"]
    api_key: str


class SaveApiKeyResponse(BaseModel):
    ok: bool
    api_provider: str


DRIVE_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DRIVE_PDF_MIME = "application/pdf"
DRIVE_ALLOWED_MIME_TYPES = {DRIVE_DOCX_MIME, DRIVE_PDF_MIME}


class DriveFileItem(BaseModel):
    id: str
    name: str
    mime_type: str
    modified_time: str | None = None
    size: int | None = None


class DriveFilesResponse(BaseModel):
    files: list[DriveFileItem]


class DriveFilesRequest(BaseModel):
    access_token: str = Field(max_length=4096)


class DriveImportRequest(BaseModel):
    access_token: str = Field(max_length=4096)
    file_id: str = Field(max_length=256)


class DriveImportResponse(BaseModel):
    markdown: str
    title: str
    mime_type: str


class GithubOAuthStartRequest(BaseModel):
    return_url: str | None = None


class GithubOAuthStartResponse(BaseModel):
    url: str


class GithubSyncRequest(BaseModel):
    title: str
    markdown: str
    repo: str
    path: str | None = None
    branch: str | None = None
    commit_message: str | None = None


class GithubSyncResponse(BaseModel):
    ok: bool
    action: Literal["created", "updated"]
    repo: str
    path: str
    branch: str | None = None
    html_url: str | None = None
    commit_sha: str | None = None


class TemplatePublishRequest(BaseModel):
    template_id: UUID


class TemplatePublishResponse(BaseModel):
    ok: bool
    template_id: UUID
    review_status: Literal["pending"]


class TemplateUseResponse(BaseModel):
    ok: bool
    template_id: UUID
    usage_count: int


class CommunityTemplateResponse(BaseModel):
    id: UUID
    user_id: UUID | None = None
    title: str
    description: str = ""
    category: str = "實驗報告"
    content: str = ""
    author_name: str = "Anonymous"
    author_avatar_url: str | None = None
    source: str = "user"
    usage_count: int = 0
    created_at: datetime
    updated_at: datetime


class OwnershipTransferRequest(BaseModel):
    recipient_email: str


class OwnershipTransferRequestResponse(BaseModel):
    ok: bool
    transfer_request_id: UUID
    expires_at: datetime
    message: str


class OwnershipTransferConfirmRequest(BaseModel):
    token: str


class OwnershipTransferConfirmResponse(BaseModel):
    ok: bool
    report_id: UUID
    from_user: UUID
    to_user: UUID


def render_markdown(text: str) -> str:
    # Closed Beta treats every fenced code block as inert report content.
    return text


def _process_markdown_for_file_export(text: str, _assets_dir: Path) -> str:
    # Export keeps code visible; no dynamic-code executor exists in this process.
    return text


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
                logger.error("Pandoc unavailable. error_type=%s", type(exc).__name__)
                raise HTTPException(
                    status_code=500,
                    detail="Pandoc 未安裝或無法執行，請聯絡管理員。",
                ) from None
            except RuntimeError as exc:
                logger.error("Pandoc conversion failed. error_type=%s", type(exc).__name__)
                raise HTTPException(
                    status_code=500,
                    detail="Word 匯出轉換失敗，請稍後重試。",
                ) from None

            if not docx_file.is_file():
                raise HTTPException(
                    status_code=500,
                    detail="Word 匯出失敗：Pandoc 未產生 .docx 檔案。",
                )

            return docx_file.read_bytes()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Word export failed. error_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail="Word 匯出失敗，請稍後重試。",
        ) from None


def _google_drive_request(
    url: str,
    access_token: str,
    *,
    timeout: int = 45,
) -> bytes:
    if not access_token.strip():
        raise HTTPException(status_code=401, detail="缺少 Google Drive access_token")

    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {access_token.strip()}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        if exc.code in {401, 403}:
            raise HTTPException(
                status_code=401,
                detail="Google Drive 授權失效或權限不足，請用 Google 重新登入並授權 Drive readonly。",
            ) from exc
        if exc.code == 404:
            raise HTTPException(status_code=404, detail="找不到指定的 Google Drive 檔案") from exc
        raise HTTPException(status_code=502, detail=f"Google Drive API 錯誤：{detail}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"無法連線 Google Drive：{exc}") from exc


def _google_drive_json(url: str, access_token: str) -> dict[str, Any]:
    raw = _google_drive_request(url, access_token)
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Google Drive 回傳格式無法解析") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="Google Drive 回傳格式不正確")
    return parsed


def _get_drive_file_metadata(file_id: str, access_token: str) -> dict[str, Any]:
    safe_file_id = urllib.parse.quote(file_id, safe="")
    fields = urllib.parse.quote("id,name,mimeType,modifiedTime,size", safe=",")
    url = f"https://www.googleapis.com/drive/v3/files/{safe_file_id}?fields={fields}"
    metadata = _google_drive_json(url, access_token)
    mime_type = metadata.get("mimeType")
    if mime_type not in DRIVE_ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail="目前只支援匯入 Word .docx 或 PDF 檔案")
    return metadata


def _download_drive_file(file_id: str, access_token: str, output_path: Path) -> None:
    safe_file_id = urllib.parse.quote(file_id, safe="")
    url = f"https://www.googleapis.com/drive/v3/files/{safe_file_id}?alt=media"
    output_path.write_bytes(_google_drive_request(url, access_token, timeout=90))


def _convert_docx_to_markdown(path: Path) -> str:
    try:
        converted = pypandoc.convert_file(str(path), "md", format="docx", encoding="utf-8")
    except OSError as exc:
        logger.exception("Pandoc 執行失敗（Drive DOCX 匯入）")
        raise HTTPException(
            status_code=500,
            detail=(
                "DOCX 匯入需要 Pandoc。請先安裝 Pandoc 並加入 PATH："
                "https://pandoc.org/installing.html"
            ),
        ) from exc
    except RuntimeError as exc:
        logger.exception("Pandoc 轉換 Drive DOCX 失敗")
        raise HTTPException(status_code=500, detail=f"DOCX 轉 Markdown 失敗：{exc}") from exc

    return str(converted).strip() + "\n"


def _convert_pdf_to_markdown(path: Path) -> str:
    try:
        reader = PdfReader(str(path))
        pages: list[str] = []
        for index, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            if text:
                pages.append(f"## Page {index}\n\n{text}")
        if not pages:
            raise HTTPException(status_code=422, detail="PDF 未擷取到文字，可能是掃描圖片型 PDF")
        return "\n\n".join(pages).strip() + "\n"
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("PDF 轉 Markdown 失敗")
        raise HTTPException(status_code=500, detail=f"PDF 解析失敗：{type(exc).__name__}: {exc}") from exc


def _convert_drive_file_to_markdown(path: Path, mime_type: str) -> str:
    if mime_type == DRIVE_DOCX_MIME:
        return _convert_docx_to_markdown(path)
    if mime_type == DRIVE_PDF_MIME:
        return _convert_pdf_to_markdown(path)
    raise HTTPException(status_code=400, detail="不支援的 Google Drive 檔案格式")


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
        logger.warning("AI upstream rejected a request. status=%s", exc.code)
        raise HTTPException(status_code=502, detail="AI 服務暫時拒絕請求，請稍後重試") from None
    except urllib.error.URLError:
        logger.warning("AI upstream is unavailable")
        raise HTTPException(status_code=502, detail="AI 服務暫時無法連線，請稍後重試") from None


def _post_form(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    data = urllib.parse.urlencode(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        logger.warning("OAuth upstream rejected a request. status=%s", exc.code)
        raise HTTPException(status_code=502, detail="OAuth 服務暫時拒絕請求，請稍後重試") from None
    except urllib.error.URLError:
        logger.warning("OAuth upstream is unavailable")
        raise HTTPException(status_code=502, detail="OAuth 服務暫時無法連線，請稍後重試") from None


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


def _get_fernet() -> Fernet:
    if not ENCRYPTION_KEY:
        raise HTTPException(
            status_code=503,
            detail="ENCRYPTION_KEY 尚未設定，無法安全儲存或使用自備 API Key",
        )
    try:
        return Fernet(ENCRYPTION_KEY.encode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="ENCRYPTION_KEY 格式錯誤，請使用 Fernet.generate_key() 產生",
        ) from exc


def encrypt_secret(value: str) -> str:
    clean_value = value.strip()
    if not clean_value:
        raise HTTPException(status_code=400, detail="API Key 不可為空")
    return _get_fernet().encrypt(clean_value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    try:
        return _get_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise HTTPException(status_code=500, detail="API Key 解密失敗，請重新儲存金鑰") from exc


def _get_user_ai_settings(user_id: str) -> dict[str, Any] | None:
    rows = _supabase_request(f"/rest/v1/user_ai_settings?user_id=eq.{user_id}&select=*")
    return rows[0] if rows else None


def _get_decrypted_user_api_key(
    user: dict[str, Any],
    requested_provider: str | None,
) -> tuple[str, str]:
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="無效的使用者")

    settings = _get_user_ai_settings(user_id)
    if not settings:
        raise HTTPException(status_code=400, detail="尚未安全儲存自備 API Key")

    stored_provider = settings.get("api_provider") or "none"
    if stored_provider == "none":
        raise HTTPException(status_code=400, detail="尚未設定 API Provider")

    if requested_provider and requested_provider != "none" and requested_provider != stored_provider:
        raise HTTPException(
            status_code=400,
            detail="請求的 API Provider 與已儲存金鑰不一致，請重新儲存金鑰",
        )

    encrypted_key = settings.get("api_key_encrypted")
    if not encrypted_key:
        raise HTTPException(status_code=400, detail="尚未安全儲存自備 API Key")

    return decrypt_secret(str(encrypted_key)), str(stored_provider)


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


def _require_user(authorization: str | None) -> dict[str, Any]:
    user = _get_user_from_authorization(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="請先登入")
    return user


def _normalize_email(value: str) -> str:
    email = value.strip().lower()
    if (
        len(email) > 254
        or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
        or any(character in email for character in ("%", "*", ","))
    ):
        raise HTTPException(status_code=400, detail="接收者 Email 格式不正確")
    return email


def _hash_transfer_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _send_transfer_confirmation_email(
    recipient_email: str,
    report_title: str,
    confirmation_url: str,
    expires_at: datetime,
) -> None:
    del recipient_email, report_title, confirmation_url, expires_at
    raise RuntimeError("Ownership transfer email provider is not configured")


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


def _stripe_configured() -> bool:
    return bool(STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID)


def _safe_billing_url(value: str | None, fallback_path: str) -> str:
    if value and value.startswith(("http://", "https://")):
        return value
    return f"{FRONTEND_URL}{fallback_path}"


def _update_profile(profile_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    rows = _supabase_request(
        f"/rest/v1/profiles?id=eq.{profile_id}",
        method="PATCH",
        payload={**payload, "updated_at": datetime.now(UTC).isoformat()},
        extra_headers={"Prefer": "return=representation"},
    )
    return rows[0] if rows else None


def _get_profile_by_stripe_customer(customer_id: str) -> dict[str, Any] | None:
    rows = _supabase_request(
        f"/rest/v1/profiles?stripe_customer_id=eq.{customer_id}&select=*"
    )
    return rows[0] if rows else None


def _github_configured() -> bool:
    return bool(GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET and GITHUB_OAUTH_STATE_SECRET)


def _github_callback_url() -> str:
    return f"{BACKEND_URL}/api/github/oauth/callback"


def _base64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))


def _sign_github_state(payload: dict[str, Any]) -> str:
    if not GITHUB_OAUTH_STATE_SECRET:
        raise HTTPException(status_code=503, detail="GITHUB_OAUTH_STATE_SECRET 尚未設定")
    body = _base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(
        GITHUB_OAUTH_STATE_SECRET.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{body}.{_base64url_encode(signature)}"


def _verify_github_state(state: str) -> dict[str, Any]:
    if not GITHUB_OAUTH_STATE_SECRET:
        raise HTTPException(status_code=503, detail="GITHUB_OAUTH_STATE_SECRET 尚未設定")
    try:
        body, signature = state.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="GitHub OAuth state 格式錯誤") from exc

    expected_signature = _base64url_encode(
        hmac.new(
            GITHUB_OAUTH_STATE_SECRET.encode("utf-8"),
            body.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    )
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=400, detail="GitHub OAuth state 驗證失敗")

    try:
        payload = json.loads(_base64url_decode(body).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="GitHub OAuth state 無法解析") from exc

    issued_at = payload.get("iat")
    if not isinstance(issued_at, int) or datetime.now(UTC).timestamp() - issued_at > 600:
        raise HTTPException(status_code=400, detail="GitHub OAuth state 已過期，請重新綁定")
    return payload


def _safe_frontend_redirect(value: str | None, fallback: str = "/dashboard/settings") -> str:
    if value:
        candidate = urllib.parse.urlparse(value)
        configured = urllib.parse.urlparse(FRONTEND_URL)
        if (
            candidate.scheme == configured.scheme
            and candidate.hostname == configured.hostname
            and candidate.port == configured.port
            and not candidate.username
            and not candidate.password
        ):
            return value
    if value and value.startswith("/"):
        return f"{FRONTEND_URL}{value}"
    return f"{FRONTEND_URL}{fallback}"


def _exchange_github_code_for_token(code: str) -> dict[str, Any]:
    if not _github_configured():
        raise HTTPException(status_code=503, detail="GitHub OAuth 尚未設定")
    assert GITHUB_CLIENT_ID is not None
    assert GITHUB_CLIENT_SECRET is not None

    token_payload = _post_form(
        "https://github.com/login/oauth/access_token",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        payload={
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
            "redirect_uri": _github_callback_url(),
        },
    )
    if token_payload.get("error"):
        raise HTTPException(
            status_code=400,
            detail=f"GitHub OAuth 失敗：{token_payload.get('error_description') or token_payload.get('error')}",
        )
    if not token_payload.get("access_token"):
        raise HTTPException(status_code=502, detail="GitHub 未回傳 access_token")
    return token_payload


def _github_api_request(
    url: str,
    token: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    allow_404: bool = False,
) -> tuple[int, dict[str, Any] | None]:
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "AutoLabReport",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw) if raw else None
            return response.status, parsed if isinstance(parsed, dict) else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        if allow_404 and exc.code == 404:
            return 404, None
        if exc.code in {401, 403}:
            raise HTTPException(status_code=401, detail="GitHub Token 無效或缺少 repo 權限，請重新綁定 GitHub") from exc
        raise HTTPException(status_code=502, detail=f"GitHub API 錯誤：{detail}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"GitHub API 無法連線：{exc}") from exc


def _get_github_user(token: str) -> dict[str, Any]:
    _status, payload = _github_api_request("https://api.github.com/user", token)
    return payload or {}


def _get_profile_integrations(profile: dict[str, Any]) -> dict[str, Any]:
    integrations = profile.get("integrations")
    return integrations if isinstance(integrations, dict) else {}


def _store_github_integration(user_id: str, token_payload: dict[str, Any]) -> dict[str, Any]:
    access_token = str(token_payload["access_token"])
    github_user = _get_github_user(access_token)
    profile = _get_or_create_profile({"id": user_id})
    integrations = _get_profile_integrations(profile)
    integrations["github"] = {
        "access_token_encrypted": encrypt_secret(access_token),
        "scope": token_payload.get("scope"),
        "token_type": token_payload.get("token_type"),
        "login": github_user.get("login"),
        "avatar_url": github_user.get("avatar_url"),
        "connected_at": datetime.now(UTC).isoformat(),
    }
    _update_profile(user_id, {"integrations": integrations})
    return integrations["github"]


def _get_decrypted_github_token(user: dict[str, Any]) -> str:
    profile = _get_or_create_profile(user)
    github = _get_profile_integrations(profile).get("github")
    if not isinstance(github, dict):
        raise HTTPException(status_code=400, detail="尚未綁定 GitHub，請先到設定頁連接 GitHub")
    encrypted_token = github.get("access_token_encrypted")
    if not isinstance(encrypted_token, str) or not encrypted_token:
        raise HTTPException(status_code=400, detail="GitHub Token 不完整，請重新綁定 GitHub")
    try:
        return decrypt_secret(encrypted_token)
    except HTTPException as exc:
        raise HTTPException(status_code=400, detail="GitHub Token 解密失敗，請重新綁定 GitHub") from exc


def _split_github_repo(repo: str) -> tuple[str, str]:
    cleaned = repo.strip().strip("/")
    parts = cleaned.split("/")
    if len(parts) != 2 or not all(parts):
        raise HTTPException(status_code=400, detail="Repo 格式必須是 owner/repo")
    return parts[0], parts[1]


def _safe_github_path(path: str | None, title: str) -> str:
    if path and path.strip():
        cleaned = path.strip().replace("\\", "/").lstrip("/")
    else:
        filename = re.sub(r"[^a-zA-Z0-9._-]+", "-", title.strip()).strip("-") or "AutoLabReport"
        cleaned = f"reports/{filename}.md"
    if cleaned.endswith("/"):
        raise HTTPException(status_code=400, detail="GitHub path 必須包含檔名")
    if not cleaned.lower().endswith(".md"):
        cleaned = f"{cleaned}.md"
    return cleaned


def _get_or_create_stripe_customer(user: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    if not _stripe_configured():
        raise HTTPException(
            status_code=503,
            detail="Stripe 尚未設定，請配置 STRIPE_SECRET_KEY 與 STRIPE_PRO_PRICE_ID",
        )

    profile = _get_or_create_profile(user)
    existing_customer_id = profile.get("stripe_customer_id")
    if existing_customer_id:
        customer = stripe.Customer.retrieve(existing_customer_id)
        customer_metadata = customer.get("metadata", {}) if isinstance(customer, dict) else customer.metadata
        if str(customer_metadata.get("supabase_user_id") or "") != str(user.get("id") or ""):
            raise HTTPException(status_code=403, detail="Stripe 客戶資料與目前帳號不一致")
        return existing_customer_id, profile

    user_id = user.get("id")
    email = user.get("email")
    metadata = user.get("user_metadata") or {}
    customer = stripe.Customer.create(
        email=email,
        name=metadata.get("full_name") or metadata.get("name"),
        metadata={"supabase_user_id": user_id},
    )
    customer_id = str(customer["id"])
    profile = _update_profile(user_id, {"stripe_customer_id": customer_id}) or profile
    return customer_id, profile


def _subscription_plan_from_status(status: str | None) -> str:
    return "pro" if status in {"active", "trialing"} else "free"


def _extract_period_end(subscription: Any) -> str | None:
    value = None
    if isinstance(subscription, dict):
        value = subscription.get("current_period_end")
    else:
        value = getattr(subscription, "current_period_end", None)
    if not value:
        return None
    return datetime.fromtimestamp(int(value), UTC).isoformat()


def _sync_subscription_to_profile(subscription: Any) -> None:
    customer_id = str(subscription.get("customer") if isinstance(subscription, dict) else subscription.customer)
    profile = _get_profile_by_stripe_customer(customer_id)
    if not profile:
        logger.warning("Stripe subscription event for unknown customer: %s", customer_id)
        return

    status = str(subscription.get("status") if isinstance(subscription, dict) else subscription.status)
    subscription_id = str(subscription.get("id") if isinstance(subscription, dict) else subscription.id)
    price_id = None
    try:
        items = subscription["items"]["data"] if isinstance(subscription, dict) else subscription["items"]["data"]
        if items:
            price_id = items[0]["price"]["id"]
    except Exception:
        price_id = None

    _update_profile(
        profile["id"],
        {
            "plan": _subscription_plan_from_status(status),
            "subscription_status": status,
            "stripe_subscription_id": subscription_id,
            "stripe_price_id": price_id,
            "subscription_current_period_end": _extract_period_end(subscription),
        },
    )


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


def _reserve_ai_quota(user: dict[str, Any]) -> dict[str, Any]:
    result = _supabase_request(
        "/rest/v1/rpc/reserve_ai_quota",
        method="POST",
        payload={
            "p_user_id": user["id"],
            "p_free_limit": FREE_DAILY_AI_QUOTA,
            "p_pro_limit": PRO_DAILY_AI_QUOTA,
        },
    )
    if not isinstance(result, dict) or not result.get("reserved"):
        raise HTTPException(status_code=402, detail="今日內建 AI 免費額度已用完")
    return result


def _refund_ai_quota(user: dict[str, Any]) -> None:
    try:
        _supabase_request(
            "/rest/v1/rpc/refund_ai_quota",
            method="POST",
            payload={"p_user_id": user["id"]},
        )
    except Exception as exc:
        logger.error("AI quota refund failed. error_type=%s", type(exc).__name__)


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
                    "content": (
                        "You are AutoLabReport's academic Markdown writing assistant. "
                        "Never change, invent, remove, or convert experimental numbers or units."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.4,
        },
    )
    return result["choices"][0]["message"]["content"].strip()


def _run_openai_client_chat(client: OpenAI, prompt: str, model: str) -> str:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are AutoLabReport's academic Markdown writing assistant. "
                    "Never change, invent, remove, or convert experimental numbers or units."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("AI provider returned an empty response")
    return content.strip()


def _run_builtin_dual_engine(prompt: str) -> tuple[str, str]:
    if groq_client is None and gemini_client is None:
        raise RuntimeError("Built-in AI is not configured")

    if groq_client is not None:
        for model in GROQ_MODELS:
            try:
                return _run_openai_client_chat(groq_client, prompt, model), f"groq:{model}"
            except Exception as exc:
                logger.warning(
                    "Groq built-in AI failed for model %s; trying next fallback. error_type=%s",
                    model,
                    type(exc).__name__,
                )

    if gemini_client is not None:
        last_error_type = "unknown"
        for model in GEMINI_MODELS:
            try:
                return (
                    _run_openai_client_chat(gemini_client, prompt, model),
                    f"gemini:{model}",
                )
            except Exception as exc:
                last_error_type = type(exc).__name__
                logger.warning(
                    "Gemini built-in AI failed for model %s; trying next fallback. error_type=%s",
                    model,
                    last_error_type,
                )
        raise HTTPException(
            status_code=502,
            detail=f"內建 AI 暫時無法使用（錯誤類型：{last_error_type}）",
        )

    raise HTTPException(
        status_code=502,
        detail="所有 Groq fallback model 都失敗，且未設定 GEMINI_API_KEY 作為 fallback",
    )


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


NUMERIC_FACT_RE = re.compile(
    r"(?<![\w])(?P<number>[-+]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][-+]?\d+)?)"
    r"(?P<spacing>\s*)"
    r"(?P<unit>%|°[CFK]|(?:[kMmunpµμ]?)(?:m|s|g|A|V|W|J|N|Pa|Hz|Ω|ohm|mol|L)(?:[²³23]|\^[-+]?\d+)?)?"
    r"(?![\w])"
)


def _canonical_number(value: str) -> str:
    normalized = value.replace(",", ".")
    try:
        decimal_value = Decimal(normalized)
    except InvalidOperation:
        return normalized.lower()
    if decimal_value == 0:
        return "0"
    return format(decimal_value.normalize(), "f")


def extract_numeric_facts(text: str) -> Counter[tuple[str, str]]:
    """Extract experimental numeric facts while ignoring Markdown list numbering."""
    without_list_numbers = re.sub(r"(?m)^\s*\d+[.)]\s+", "", text)
    facts: Counter[tuple[str, str]] = Counter()
    for match in NUMERIC_FACT_RE.finditer(without_list_numbers):
        unit = (match.group("unit") or "").replace("μ", "µ").lower()
        facts[(_canonical_number(match.group("number")), unit)] += 1
    return facts


def validate_numeric_integrity(source: str, candidate: str) -> tuple[bool, dict[str, int]]:
    source_facts = extract_numeric_facts(source)
    candidate_facts = extract_numeric_facts(candidate)
    missing = sum((source_facts - candidate_facts).values())
    added = sum((candidate_facts - source_facts).values())
    return missing == 0 and added == 0, {"missing": missing, "added": added}


def _enforce_numeric_integrity(source: str, candidate: str) -> None:
    is_valid, differences = validate_numeric_integrity(source, candidate)
    if is_valid:
        return
    logger.warning(
        "AI output blocked by numeric-integrity guard. missing=%s added=%s",
        differences["missing"],
        differences["added"],
    )
    raise HTTPException(
        status_code=422,
        detail="AI 結果未通過數字與單位完整性檢查，文件未被修改。請縮小選取範圍後重試。",
    )


def _run_ai_provider(
    body: AiRunRequest,
    user_api_key: str | None = None,
    user_api_provider: str | None = None,
) -> tuple[str, str | None]:
    prompt = body.prompt or body.text
    provider = user_api_provider or body.api_provider or "none"

    if body.provider == "built_in":
        if groq_client is not None or gemini_client is not None:
            return _run_builtin_dual_engine(prompt)
        return _fallback_ai_response(body.action, body.text), "fallback-rule"

    if body.provider == "user_api_key":
        if not user_api_key or provider == "none":
            raise HTTPException(status_code=400, detail="請先安全儲存 API Provider 與 API Key")

        if provider == "openai":
            model = body.model or "gpt-4o-mini"
            return _run_openai_compatible(user_api_key, prompt, model), model
        if provider == "deepseek":
            model = body.model or "deepseek-chat"
            return (
                _run_openai_compatible(
                    user_api_key,
                    prompt,
                    model,
                    "https://api.deepseek.com/chat/completions",
                ),
                model,
            )
        if provider == "gemini":
            model = body.model or "gemini-1.5-flash"
            return _run_gemini(user_api_key, prompt, model), model
        if provider == "anthropic":
            model = body.model or "claude-3-5-haiku-latest"
            return _run_anthropic(user_api_key, prompt, model), model

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
        "不得改寫、刪除、新增或換算任何實驗數字與單位；資料不足時必須保留原值並提出問題。"
        "只回傳有效 JSON，不要 markdown code fence，不要額外解釋。\n\n"
        f"Agent 模式：{body.mode} - {mode_instructions[body.mode]}\n"
        f"使用者目標：{body.goal or '未提供，請根據模式處理'}\n"
        f"選取文字：\n{body.selected_text or ''}\n\n"
        f"目前文件 Markdown：\n{body.document_markdown}\n\n"
        f"JSON schema 範例：{json.dumps(output_schema, ensure_ascii=False)}"
    )


def _run_agent_provider(
    body: AgentRunRequest,
    user_api_key: str | None = None,
    user_api_provider: str | None = None,
) -> tuple[AgentRunResponse, str | None]:
    prompt = _build_agent_prompt(body)
    ai_body = AiRunRequest(
        provider=body.provider,
        action="custom",
        text=body.document_markdown,
        prompt=prompt,
        api_provider=body.api_provider,
        model=body.model,
    )
    text, model = _run_ai_provider(ai_body, user_api_key, user_api_provider)
    response = _parse_agent_json(text, body.mode)
    response.model = model
    return response, model


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "AutoLabReport API"}


@app.get("/api/readiness")
def readiness():
    checks = {
        "supabase": _supabase_configured(),
        "encryption": bool(ENCRYPTION_KEY),
        "pandoc": False,
        "built_in_ai": groq_client is not None or gemini_client is not None,
    }
    try:
        checks["pandoc"] = bool(pypandoc.get_pandoc_path())
    except OSError:
        checks["pandoc"] = False

    required_ready = checks["supabase"] and checks["encryption"] and checks["pandoc"]
    if not required_ready:
        raise HTTPException(
            status_code=503,
            detail={"status": "not_ready", "checks": checks},
        )
    return {"status": "ready", "checks": checks}


@app.get("/keep-alive")
def keep_alive():
    return {"status": "I am awake!", "message": "Render 伺服器保活中"}


@app.post("/api/render", response_model=RenderResponse)
def render(body: RenderRequest):
    return RenderResponse(markdown=render_markdown(body.markdown))


@app.post("/api/generate-outline", response_model=OutlineResponse)
def generate_outline(body: OutlineRequest):
    return OutlineResponse(markdown=generate_outline_from_sample(body.sample_structure))


@app.post("/api/keys/save", response_model=SaveApiKeyResponse)
def save_user_api_key(body: SaveApiKeyRequest, authorization: str | None = Header(default=None)):
    user = _get_user_from_authorization(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="請先登入")

    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="無效的使用者")

    encrypted_key = encrypt_secret(body.api_key)
    _supabase_request(
        "/rest/v1/user_ai_settings?on_conflict=user_id",
        method="POST",
        payload={
            "user_id": user_id,
            "preferred_provider": "user_api_key",
            "api_provider": body.api_provider,
            "api_key_encrypted": encrypted_key,
            "updated_at": datetime.now(UTC).isoformat(),
        },
        extra_headers={
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    return SaveApiKeyResponse(ok=True, api_provider=body.api_provider)


@app.post("/api/ai/run", response_model=AiRunResponse)
def run_ai(body: AiRunRequest, authorization: str | None = Header(default=None)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="請提供要處理的文字")

    user = _get_user_from_authorization(authorization)
    quota: dict[str, Any] | None = None
    model: str | None = None
    decrypted_user_api_key: str | None = None
    decrypted_user_api_provider: str | None = None
    quota_reserved = False
    try:
        if body.provider == "built_in":
            if user is None:
                raise HTTPException(status_code=401, detail="內建 AI 需要登入後使用")
            quota = _reserve_ai_quota(user)
            quota_reserved = True
        elif body.provider == "user_api_key":
            if user is None:
                raise HTTPException(status_code=401, detail="自備 API Key 需要登入後使用")
            decrypted_user_api_key, decrypted_user_api_provider = _get_decrypted_user_api_key(
                user,
                body.api_provider,
            )

        markdown, model = _run_ai_provider(body, decrypted_user_api_key, decrypted_user_api_provider)
        if body.action != "outline":
            _enforce_numeric_integrity(text, markdown)
        _log_ai_usage(user, body, model, "success")
    except HTTPException:
        if quota_reserved and user is not None:
            _refund_ai_quota(user)
        _log_ai_usage(user, body, model, "error")
        raise
    except Exception:
        if quota_reserved and user is not None:
            _refund_ai_quota(user)
        raise
    finally:
        decrypted_user_api_key = None

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
    decrypted_user_api_key: str | None = None
    decrypted_user_api_provider: str | None = None
    quota_reserved = False

    try:
        if body.provider == "built_in":
            if user is None:
                raise HTTPException(status_code=401, detail="Agent 需要登入後使用內建 AI")
            quota = _reserve_ai_quota(user)
            quota_reserved = True
        elif body.provider == "user_api_key":
            if user is None:
                raise HTTPException(status_code=401, detail="自備 API Key 需要登入後使用")
            decrypted_user_api_key, decrypted_user_api_provider = _get_decrypted_user_api_key(
                user,
                body.api_provider,
            )

        has_llm_key = (
            body.provider == "user_api_key"
            and bool(decrypted_user_api_key)
            and decrypted_user_api_provider not in {None, "none"}
        ) or (
            body.provider == "built_in"
            and (groq_client is not None or gemini_client is not None)
        )

        if has_llm_key:
            response, model = _run_agent_provider(
                body,
                decrypted_user_api_key,
                decrypted_user_api_provider,
            )
        else:
            response = _fallback_agent_response(body)
            model = response.model

        if response.proposed_markdown:
            _enforce_numeric_integrity(body.document_markdown, response.proposed_markdown)

        response.remaining_quota = quota["remaining"] if quota else None
        response.model = model
        return response
    except HTTPException:
        if quota_reserved and user is not None:
            _refund_ai_quota(user)
        raise
    except Exception:
        if quota_reserved and user is not None:
            _refund_ai_quota(user)
        raise
    finally:
        decrypted_user_api_key = None


@app.post("/api/templates/publish", response_model=TemplatePublishResponse)
def publish_template(
    body: TemplatePublishRequest,
    authorization: str | None = Header(default=None),
):
    user = _require_user(authorization)
    user_id = user.get("id")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="無效的使用者")

    template_id = str(body.template_id)
    rows = _supabase_request(
        "/rest/v1/report_templates"
        f"?id=eq.{template_id}"
        "&select=id,user_id,source,review_status"
    )
    if not rows:
        raise HTTPException(status_code=404, detail="找不到模板")

    template = rows[0]
    if template.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="只有模板擁有者可以申請發布")
    if template.get("source") != "user":
        raise HTTPException(status_code=400, detail="系統模板不需要提交社群審核")

    _supabase_request(
        f"/rest/v1/report_templates?id=eq.{template_id}&user_id=eq.{user_id}",
        method="PATCH",
        payload={
            "review_status": "pending",
            "is_public": False,
            "visibility": "private",
            "updated_at": datetime.now(UTC).isoformat(),
        },
        extra_headers={"Prefer": "return=minimal"},
    )
    return TemplatePublishResponse(
        ok=True,
        template_id=body.template_id,
        review_status="pending",
    )


@app.post("/api/templates/use/{template_id}", response_model=TemplateUseResponse)
def use_community_template(template_id: UUID):
    usage_count = _supabase_request(
        "/rest/v1/rpc/increment_template_usage",
        method="POST",
        payload={"p_template_id": str(template_id)},
    )
    if usage_count is None:
        raise HTTPException(status_code=404, detail="找不到已核准的公開模板")
    if not isinstance(usage_count, int):
        raise HTTPException(status_code=502, detail="模板使用次數回傳格式錯誤")

    return TemplateUseResponse(
        ok=True,
        template_id=template_id,
        usage_count=usage_count,
    )


@app.get("/api/templates/community", response_model=list[CommunityTemplateResponse])
def list_community_templates():
    rows = _supabase_request(
        "/rest/v1/report_templates"
        "?is_public=eq.true"
        "&review_status=eq.approved"
        "&select=id,user_id,title,description,category,content,author_name,"
        "author_avatar_url,source,usage_count,created_at,updated_at"
        "&order=usage_count.desc,created_at.desc"
    )
    return rows or []


@app.post(
    "/api/reports/{report_id}/transfer/request",
    response_model=OwnershipTransferRequestResponse,
)
def request_report_ownership_transfer(
    report_id: UUID,
    body: OwnershipTransferRequest,
    authorization: str | None = Header(default=None),
):
    if not OWNERSHIP_TRANSFER_EMAIL_CONFIGURED:
        raise HTTPException(
            status_code=503,
            detail="Closed Beta 尚未啟用所有權轉移郵件；請聯絡產品管理員處理。",
        )
    sender = _require_user(authorization)
    sender_id = sender.get("id")
    if not isinstance(sender_id, str) or not sender_id:
        raise HTTPException(status_code=401, detail="無效的使用者")
    _get_or_create_profile(sender)

    report_id_text = str(report_id)
    reports = _supabase_request(
        f"/rest/v1/documents?id=eq.{report_id_text}&select=id,user_id,title"
    )
    if not reports:
        raise HTTPException(status_code=404, detail="找不到報告")
    report = reports[0]
    if report.get("user_id") != sender_id:
        raise HTTPException(status_code=403, detail="只有目前擁有者可以發起轉移")

    recipient_email = _normalize_email(body.recipient_email)
    sender_email = str(sender.get("email") or "").strip().lower()
    if recipient_email == sender_email:
        raise HTTPException(status_code=400, detail="不能將報告轉移給自己")

    recipient = _supabase_request(
        "/rest/v1/rpc/resolve_transfer_recipient",
        method="POST",
        payload={"p_email": recipient_email},
    )
    if not isinstance(recipient, dict):
        raise HTTPException(status_code=404, detail="找不到已註冊的接收者")
    recipient_id = recipient.get("id")
    if not isinstance(recipient_id, str) or not recipient_id:
        raise HTTPException(status_code=404, detail="接收者帳號資料不完整")
    if recipient_id == sender_id:
        raise HTTPException(status_code=400, detail="不能將報告轉移給自己")

    now = datetime.now(UTC)
    expires_at = now + timedelta(hours=24)
    raw_token = secrets.token_urlsafe(48)
    token_hash = _hash_transfer_token(raw_token)

    _supabase_request(
        "/rest/v1/transfer_requests"
        f"?report_id=eq.{report_id_text}"
        f"&from_user=eq.{sender_id}"
        "&status=eq.pending",
        method="PATCH",
        payload={
            "status": "cancelled",
            "cancelled_at": now.isoformat(),
        },
        extra_headers={"Prefer": "return=minimal"},
    )
    created = _supabase_request(
        "/rest/v1/transfer_requests",
        method="POST",
        payload={
            "report_id": report_id_text,
            "from_user": sender_id,
            "to_user": recipient_id,
            "token_hash": token_hash,
            "expires_at": expires_at.isoformat(),
            "status": "pending",
        },
        extra_headers={"Prefer": "return=representation"},
    )
    if not created:
        raise HTTPException(status_code=502, detail="無法建立轉移請求")

    confirmation_url = (
        f"{FRONTEND_URL}/transfer/confirm"
        f"?token={urllib.parse.quote(raw_token, safe='')}"
    )
    _send_transfer_confirmation_email(
        recipient_email,
        str(report.get("title") or "未命名報告"),
        confirmation_url,
        expires_at,
    )
    raw_token = ""

    return OwnershipTransferRequestResponse(
        ok=True,
        transfer_request_id=UUID(str(created[0]["id"])),
        expires_at=expires_at,
        message="確認信已發送給接收者，連結將於 24 小時後失效",
    )


@app.post(
    "/api/reports/transfer/confirm",
    response_model=OwnershipTransferConfirmResponse,
)
def confirm_report_ownership_transfer(
    body: OwnershipTransferConfirmRequest,
    authorization: str | None = Header(default=None),
):
    recipient = _require_user(authorization)
    recipient_id = recipient.get("id")
    if not isinstance(recipient_id, str) or not recipient_id:
        raise HTTPException(status_code=401, detail="無效的使用者")

    token = body.token.strip()
    if len(token) < 32 or len(token) > 512:
        raise HTTPException(status_code=400, detail="轉移連結無效或已失效")

    result = _supabase_request(
        "/rest/v1/rpc/confirm_report_ownership_transfer",
        method="POST",
        payload={
            "p_token_hash": _hash_transfer_token(token),
            "p_recipient_user_id": recipient_id,
        },
    )
    token = ""
    if not isinstance(result, dict) or not result.get("ok"):
        code = result.get("code") if isinstance(result, dict) else "invalid_token"
        if code == "wrong_recipient":
            raise HTTPException(status_code=403, detail="此轉移連結不屬於目前登入帳號")
        if code in {"already_processed", "owner_changed"}:
            raise HTTPException(status_code=409, detail="此轉移請求已處理或報告擁有者已變更")
        raise HTTPException(status_code=400, detail="轉移連結無效或已失效")

    return OwnershipTransferConfirmResponse(
        ok=True,
        report_id=UUID(str(result["report_id"])),
        from_user=UUID(str(result["from_user"])),
        to_user=UUID(str(result["to_user"])),
    )


@app.get("/api/billing/config", response_model=BillingConfigResponse)
def get_billing_config():
    enabled = bool(STRIPE_BILLING_ENABLED and STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID)
    return BillingConfigResponse(
        enabled=enabled,
        pro_price_id_configured=bool(STRIPE_PRO_PRICE_ID),
        customer_portal_url=None,
        message="Stripe 已可接入" if enabled else "Stripe 尚未設定，請先配置 STRIPE_SECRET_KEY 與 STRIPE_PRO_PRICE_ID",
    )


@app.post("/api/stripe/create-checkout-session", response_model=StripeSessionResponse)
def create_checkout_session(
    body: StripeSessionRequest,
    authorization: str | None = Header(default=None),
):
    if not STRIPE_BILLING_ENABLED:
        raise HTTPException(status_code=503, detail="Stripe 不在本次 Closed Beta 範圍內")
    user = _get_user_from_authorization(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="請先登入")

    customer_id, _profile = _get_or_create_stripe_customer(user)
    success_url = _safe_billing_url(body.success_url, "/?billing=success")
    cancel_url = _safe_billing_url(body.cancel_url, "/?billing=cancel")

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        client_reference_id=user["id"],
        line_items=[{"price": STRIPE_PRO_PRICE_ID, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"supabase_user_id": user["id"]},
        subscription_data={"metadata": {"supabase_user_id": user["id"]}},
        allow_promotion_codes=True,
    )
    if not session.url:
        raise HTTPException(status_code=502, detail="Stripe 未回傳 Checkout URL")
    return StripeSessionResponse(url=session.url)


@app.post("/api/stripe/create-portal-session", response_model=StripeSessionResponse)
def create_portal_session(
    body: StripeSessionRequest,
    authorization: str | None = Header(default=None),
):
    if not STRIPE_BILLING_ENABLED:
        raise HTTPException(status_code=503, detail="Stripe 不在本次 Closed Beta 範圍內")
    user = _get_user_from_authorization(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="請先登入")

    customer_id, _profile = _get_or_create_stripe_customer(user)
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=_safe_billing_url(body.return_url, "/"),
    )
    if not session.url:
        raise HTTPException(status_code=502, detail="Stripe 未回傳 Customer Portal URL")
    return StripeSessionResponse(url=session.url)


@app.post("/api/github/oauth/start", response_model=GithubOAuthStartResponse)
def start_github_oauth(
    body: GithubOAuthStartRequest,
    authorization: str | None = Header(default=None),
):
    if not GITHUB_SYNC_ENABLED:
        raise HTTPException(status_code=503, detail="GitHub 同步不在本次 Closed Beta 範圍內")
    user = _require_user(authorization)
    if not _github_configured():
        raise HTTPException(
            status_code=503,
            detail="GitHub OAuth 尚未設定，請配置 GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET、GITHUB_OAUTH_STATE_SECRET",
        )
    assert GITHUB_CLIENT_ID is not None

    state = _sign_github_state(
        {
            "user_id": user["id"],
            "return_url": _safe_frontend_redirect(body.return_url),
            "nonce": secrets.token_urlsafe(18),
            "iat": int(datetime.now(UTC).timestamp()),
        }
    )
    params = urllib.parse.urlencode(
        {
            "client_id": GITHUB_CLIENT_ID,
            "redirect_uri": _github_callback_url(),
            "scope": "repo",
            "state": state,
            "allow_signup": "true",
        }
    )
    return GithubOAuthStartResponse(url=f"https://github.com/login/oauth/authorize?{params}")


@app.get("/api/github/oauth/callback")
def github_oauth_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if not GITHUB_SYNC_ENABLED:
        raise HTTPException(status_code=503, detail="GitHub 同步不在本次 Closed Beta 範圍內")
    fallback_url = _safe_frontend_redirect(None)
    if error:
        return RedirectResponse(f"{fallback_url}?github=error&message={urllib.parse.quote(error)}")
    if not code or not state:
        return RedirectResponse(f"{fallback_url}?github=error&message=missing_code_or_state")

    try:
        state_payload = _verify_github_state(state)
        user_id = state_payload.get("user_id")
        if not isinstance(user_id, str) or not user_id:
            raise HTTPException(status_code=400, detail="GitHub OAuth state 缺少 user_id")
        token_payload = _exchange_github_code_for_token(code)
        _store_github_integration(user_id, token_payload)
        return_url = _safe_frontend_redirect(state_payload.get("return_url"))
        return RedirectResponse(f"{return_url}?github=connected")
    except HTTPException as exc:
        logger.exception("GitHub OAuth callback failed")
        return RedirectResponse(
            f"{fallback_url}?github=error&message={urllib.parse.quote(str(exc.detail))}"
        )
    except Exception as exc:
        logger.exception("GitHub OAuth callback unexpected failure")
        return RedirectResponse(
            f"{fallback_url}?github=error&message={urllib.parse.quote(type(exc).__name__)}"
        )


@app.post("/api/github/sync", response_model=GithubSyncResponse)
def sync_report_to_github(
    body: GithubSyncRequest,
    authorization: str | None = Header(default=None),
):
    if not GITHUB_SYNC_ENABLED:
        raise HTTPException(status_code=503, detail="GitHub 同步不在本次 Closed Beta 範圍內")
    user = _require_user(authorization)
    if not body.markdown.strip():
        raise HTTPException(status_code=400, detail="Markdown 內容不可為空")

    token = _get_decrypted_github_token(user)
    owner, repo_name = _split_github_repo(body.repo)
    path = _safe_github_path(body.path, body.title)
    branch = body.branch.strip() if body.branch and body.branch.strip() else None
    encoded_path = urllib.parse.quote(path, safe="")
    base_url = f"https://api.github.com/repos/{owner}/{repo_name}/contents/{encoded_path}"

    query = f"?ref={urllib.parse.quote(branch)}" if branch else ""
    status, existing = _github_api_request(f"{base_url}{query}", token, allow_404=True)
    sha = existing.get("sha") if status != 404 and isinstance(existing, dict) else None
    if sha is not None and not isinstance(sha, str):
        raise HTTPException(status_code=409, detail="目標路徑不是可覆蓋的單一檔案")

    commit_message = (
        body.commit_message.strip()
        if body.commit_message and body.commit_message.strip()
        else f"AutoLabReport: Sync report {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S UTC')}"
    )
    payload: dict[str, Any] = {
        "message": commit_message,
        "content": base64.b64encode(body.markdown.encode("utf-8")).decode("ascii"),
    }
    if sha:
        payload["sha"] = sha
    if branch:
        payload["branch"] = branch

    _put_status, result = _github_api_request(base_url, token, method="PUT", payload=payload)
    content = result.get("content") if isinstance(result, dict) else None
    commit = result.get("commit") if isinstance(result, dict) else None
    html_url = content.get("html_url") if isinstance(content, dict) else None
    commit_sha = commit.get("sha") if isinstance(commit, dict) else None

    return GithubSyncResponse(
        ok=True,
        action="updated" if sha else "created",
        repo=f"{owner}/{repo_name}",
        path=path,
        branch=branch,
        html_url=html_url if isinstance(html_url, str) else None,
        commit_sha=commit_sha if isinstance(commit_sha, str) else None,
    )


@app.post("/api/stripe/webhook")
async def stripe_webhook(request: Request, stripe_signature: str | None = Header(default=None)):
    if not STRIPE_BILLING_ENABLED:
        raise HTTPException(status_code=503, detail="Stripe 不在本次 Closed Beta 範圍內")
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="STRIPE_WEBHOOK_SECRET 尚未設定")

    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=stripe_signature,
            secret=STRIPE_WEBHOOK_SECRET,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook payload") from exc
    except stripe.SignatureVerificationError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature") from exc

    event_type = event["type"]
    data_object = event["data"]["object"]

    if event_type == "checkout.session.completed":
        customer_id = data_object.get("customer")
        user_id = data_object.get("client_reference_id") or data_object.get("metadata", {}).get("supabase_user_id")
        if customer_id and user_id:
            _update_profile(str(user_id), {"stripe_customer_id": str(customer_id)})
        subscription_id = data_object.get("subscription")
        if subscription_id:
            subscription = stripe.Subscription.retrieve(subscription_id)
            _sync_subscription_to_profile(subscription)
    elif event_type in {"customer.subscription.updated", "customer.subscription.deleted"}:
        _sync_subscription_to_profile(data_object)
    else:
        logger.info("Unhandled Stripe webhook event: %s", event_type)

    return {"received": True}


@app.post("/api/export")
def export_docx(body: RenderRequest):
    try:
        docx_bytes = export_markdown_to_docx(body.markdown)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("/api/export failed. error_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail="Word 匯出失敗，請確認 Pandoc 已安裝後重試。",
        ) from None

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


@app.post("/api/drive/files", response_model=DriveFilesResponse)
def list_drive_files(body: DriveFilesRequest):
    if not GOOGLE_DRIVE_ENABLED:
        raise HTTPException(status_code=503, detail="Google Drive 不在本次 Closed Beta 範圍內")
    access_token = body.access_token
    query = " or ".join(f"mimeType='{mime_type}'" for mime_type in sorted(DRIVE_ALLOWED_MIME_TYPES))
    params = urllib.parse.urlencode(
        {
            "q": f"trashed=false and ({query})",
            "pageSize": "50",
            "orderBy": "modifiedTime desc",
            "fields": "files(id,name,mimeType,modifiedTime,size)",
        }
    )
    url = f"https://www.googleapis.com/drive/v3/files?{params}"
    payload = _google_drive_json(url, access_token)
    raw_files = payload.get("files", [])
    if not isinstance(raw_files, list):
        raise HTTPException(status_code=502, detail="Google Drive 檔案列表格式不正確")

    files: list[DriveFileItem] = []
    for item in raw_files:
        if not isinstance(item, dict):
            continue
        mime_type = item.get("mimeType")
        file_id = item.get("id")
        name = item.get("name")
        if mime_type not in DRIVE_ALLOWED_MIME_TYPES or not isinstance(file_id, str) or not isinstance(name, str):
            continue
        size_value = item.get("size")
        size = int(size_value) if isinstance(size_value, str) and size_value.isdigit() else None
        files.append(
            DriveFileItem(
                id=file_id,
                name=name,
                mime_type=mime_type,
                modified_time=item.get("modifiedTime") if isinstance(item.get("modifiedTime"), str) else None,
                size=size,
            )
        )

    return DriveFilesResponse(files=files)


@app.post("/api/drive/import", response_model=DriveImportResponse)
def import_drive_file(body: DriveImportRequest):
    if not GOOGLE_DRIVE_ENABLED:
        raise HTTPException(status_code=503, detail="Google Drive 不在本次 Closed Beta 範圍內")
    metadata = _get_drive_file_metadata(body.file_id, body.access_token)
    name = str(metadata.get("name") or "Google Drive 匯入檔案")
    mime_type = str(metadata.get("mimeType") or "")
    suffix = ".docx" if mime_type == DRIVE_DOCX_MIME else ".pdf"

    with tempfile.TemporaryDirectory() as tmp:
        temp_path = Path(tmp) / f"drive-import{suffix}"
        _download_drive_file(body.file_id, body.access_token, temp_path)
        markdown = _convert_drive_file_to_markdown(temp_path, mime_type)

    title = re.sub(r"\.(docx|pdf)$", "", name, flags=re.IGNORECASE).strip() or "Google Drive 匯入檔案"
    return DriveImportResponse(markdown=markdown, title=title, mime_type=mime_type)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("UVICORN_RELOAD") == "true",
    )
