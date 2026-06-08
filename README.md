# AutoLabReport

> AI-powered collaborative Markdown workspace for STEM lab reports.

AutoLabReport 是一個為理工科實驗報告打造的現代化 SaaS 寫作平台。它結合 Markdown 編輯、AI 內容整理、即時預覽、Python 圖表渲染、Word/PDF 匯出、多人協作與 Supabase 雲端文件管理，讓學生與研究者可以用更接近 Notion、HackMD 與 Google Docs 的體驗完成實驗報告。

![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=fff)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?style=flat-square&logo=fastapi&logoColor=fff)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%26%20Database-3FCF8E?style=flat-square&logo=supabase&logoColor=111)
![Yjs](https://img.shields.io/badge/Yjs-WebRTC%20Collaboration-f6c915?style=flat-square)

---

## Product Overview

AutoLabReport is designed for students, teaching assistants, and lab teams who need to turn AI-generated drafts, experiment notes, data tables, Python plots, formulas, and diagrams into polished academic reports.

The current product experience includes:

- A clean commercial SaaS landing page with Google, GitHub, and Email Magic Link authentication.
- A Canva-style dashboard for managing recent reports, favorites, templates, and trash.
- A HackMD-inspired editor with a dark Monaco Markdown editor and a bright paper-like preview pane.
- Supabase-backed document CRUD for authenticated users.
- Local guest mode for quick testing without account setup.
- Word/PDF export workflows for final submission.
- Yjs + WebRTC collaboration room per document.
- Chrome extension bridge for sending content from ChatGPT into AutoLabReport.

---

## Key Features

### Authentication

- Supabase Auth integration.
- Google OAuth login.
- GitHub OAuth login.
- Email Magic Link login.
- Guest mode for local testing.
- User profile rendering with `avatar_url`, display name, and email.

### Document Workspace

- Dashboard grid with document previews.
- Supabase `documents` table integration for authenticated users.
- Create, rename, favorite, soft delete, restore, and permanently delete documents.
- Favorites view for pinned reports.
- Trash view with restore and hard-delete actions.
- LocalStorage fallback for guest mode.

### Markdown Editor

- Monaco Editor with a dark HackMD-style writing surface.
- Debounced preview rendering.
- Synchronized editor-to-preview scrolling.
- Markdown preprocessing for figure/table auto-numbering.
- Smart formatting cleanup for AI-generated text.
- Excel/CSV paste conversion into Markdown tables.

### Academic Rendering

- KaTeX math rendering.
- Mermaid diagram rendering.
- Python code block execution through FastAPI for plot generation.
- Markdown preview optimized for academic report spacing.
- A4-like preview surface for export-ready reading.

### Export

- Export Markdown to Word `.docx` through FastAPI + Pandoc.
- Export preview to PDF through `html2pdf.js` and `html2canvas-pro`.
- PDF output follows the rendered preview surface.

### AI Workflow

- Generate report outline from a sample structure.
- Smart formatting repair for common AI output issues.
- Chrome extension bridge for capturing ChatGPT content.
- Notion-style selected-text AI request events for rewrite/expand workflows.

### Collaboration

- Yjs document model.
- WebRTC provider per document room.
- Shared text binding for collaborative editing.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS, Monaco Editor |
| Auth & Database | Supabase Auth, Supabase Postgres |
| Markdown | react-markdown, remark-math, rehype-katex, rehype-raw |
| Diagrams | Mermaid.js |
| Collaboration | Yjs, y-webrtc |
| Export | html2pdf.js, html2canvas-pro, FastAPI, Pandoc |
| Backend | Python, FastAPI, matplotlib, numpy, scipy, pypandoc |
| Extension | Chrome Extension Manifest V3 |

---

## Project Structure

```txt
AutoLabReport/
├── backend/
│   ├── main.py                 # FastAPI render/export/outline API
│   └── requirements.txt
├── extension/
│   ├── manifest.json           # Chrome extension manifest
│   ├── background.js
│   └── content.js
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main SaaS shell, editor, dashboard, auth flow
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   └── vite.config.ts
├── package.json
└── README.md
```

---

## Supabase Setup

Create a Supabase project and add the following environment variables to `frontend/.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:8000
```

### Recommended `documents` Table

The frontend expects a `documents` table compatible with the following shape:

```sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null default '未命名報告',
  content text not null default '',
  is_favorite boolean not null default false,
  is_trashed boolean not null default false,
  type text not null default 'file',
  parent_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

For production, enable Row Level Security and bind documents to the authenticated user:

```sql
alter table documents enable row level security;

create policy "Users can read their own documents"
on documents for select
using (auth.uid() = user_id);

create policy "Users can create their own documents"
on documents for insert
with check (auth.uid() = user_id);

create policy "Users can update their own documents"
on documents for update
using (auth.uid() = user_id);

create policy "Users can delete their own documents"
on documents for delete
using (auth.uid() = user_id);
```

If your table uses RLS, make sure inserts include `user_id` or use a trigger to set it automatically.

---

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.10+
- Pandoc installed and available in PATH
- Supabase project for production auth/database

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

Backend default URL:

```txt
http://localhost:8000
```

Useful endpoints:

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/health` | API health check |
| GET | `/keep-alive` | Lightweight keep-alive endpoint for Render |
| POST | `/api/render` | Render Markdown and execute supported Python plot blocks |
| POST | `/api/export` | Export Markdown to Word `.docx` |
| POST | `/api/generate-outline` | Generate a report outline from a sample structure |

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Frontend default URL:

```txt
http://localhost:5173
```

### 3. Chrome Extension

Load the extension manually in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select the `extension/` directory.

The extension can bridge selected or latest ChatGPT content into AutoLabReport.

---

## Environment Variables

| Variable | Scope | Description |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Frontend | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Supabase anon public key |
| `VITE_API_URL` | Frontend | FastAPI backend URL. Defaults to `http://localhost:8000` |

---

## Development Commands

### Frontend

```powershell
cd frontend
npm run dev
npm run lint
npm run build
```

### Backend

```powershell
cd backend
python main.py
```

---

## Product Workflow

1. Sign in with Google, GitHub, or Email Magic Link.
2. Create a new report from Dashboard or apply a template from Template Hub.
3. Paste AI-generated notes, lab content, Python snippets, formulas, tables, or Mermaid diagrams.
4. Use the smart formatter to clean AI output.
5. Preview the report in the paper-like right pane.
6. Export as Word or PDF.
7. Share the document link or collaborate in the same Yjs/WebRTC room.

---

## Current Status

AutoLabReport is actively evolving from a Markdown report editor into a full SaaS workspace for academic writing. The current implementation already includes authentication, dashboard, database-backed documents, template hub, editor, export workflows, collaboration primitives, and browser extension integration.

Planned improvements include:

- Fine-grained Supabase RLS and user-owned document permissions.
- Production-grade collaboration persistence.
- Dedicated settings and billing pages.
- Improved AI rewrite workflows.
- More STEM-specific report templates.
- File/folder drag-and-drop organization.

---

## License

This project is currently maintained as a private/product prototype. Add a license before public distribution.

