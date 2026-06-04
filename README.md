# AutoLabReport

針對理工科學生的 B2C **Markdown 實驗報告編輯器**。使用者可在左側貼上從 ChatGPT 等工具複製的實驗內文與 Python（含 matplotlib）程式碼；系統會即時預覽 Markdown，並在後續階段於伺服器安全執行 ` ```python ` 區塊、將圖表轉為 Base64 嵌入預覽，最後透過 Pandoc 一鍵匯出排版穩定的 Word（`.docx`）。

> **目前階段：Phase 3C** — 即時預覽 + Word 後端匯出 + **PDF 前端所見即所得**（html2pdf.js）。Word 匯出需安裝 [Pandoc](https://pandoc.org/installing.html)。

## 技術棧

| 層級 | 技術 |
|------|------|
| 前端 | React (Vite) + TailwindCSS + Monaco Editor + html2pdf.js |
| 後端 | Python FastAPI + pypandoc + matplotlib |

## 專案結構

```
AutoLabReport/
├── frontend/          # React 雙欄編輯器 UI
├── backend/           # FastAPI API
│   ├── main.py
│   └── requirements.txt
└── README.md
```

## 環境需求

- **Node.js** 18+（建議 20+）
- **Python** 3.10+
- **Pandoc**（匯出 Word 必備，需加入系統 PATH）

## 啟動方式

請開啟**兩個終端機視窗**，分別啟動後端與前端。

### 1. 後端（FastAPI）

```powershell
cd D:\AutoLabReport\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

後端預設監聽：`http://localhost:8000`

- 健康檢查：`GET http://localhost:8000/api/health`
- 互動式 API 文件：`http://localhost:8000/docs`

### 2. 前端（Vite + React）

```powershell
cd D:\AutoLabReport\frontend
npm install
npm run dev
```

前端預設：`http://localhost:5173`

在瀏覽器開啟後，左側編輯預設範例含 ` ```python ` 區塊；約 0.8 秒後右側應顯示標題與 **sin 波形圖**。亦可點擊 **「測試後端連線」** 確認 API 正常。

## Phase 3C 驗證清單

- [ ] 右側預覽正常顯示圖表與中文標題
- [ ] **「📥 匯出 Word 報告」** → `AutoLabReport.docx`
- [ ] **「📄 匯出 PDF」** → `AutoLabReport.pdf`（擷取右側預覽，中文與圖表與畫面一致）

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/health` | 健康檢查 |
| POST | `/api/render` | Markdown → 含 Base64 圖的 HTML 預覽用 Markdown |
| POST | `/api/export` | Markdown → `.docx` 檔案下載 |
