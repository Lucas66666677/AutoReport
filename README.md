# AutoLabReport

AutoLabReport 是面向大学实验课程的 Markdown 报告工作区。当前代码以「20 位学生 Closed Beta」为目标：先保证写作、保存、预览、检查、分享与导出可靠，再逐步开放计费、实时协作和第三方同步。

## Closed Beta 范围

本轮支持：

- Email Magic Link、Google OAuth，以及明确标示为本机保存的访客模式。
- 登录用户的云端文件／资料夹 CRUD、收藏、垃圾桶、恢复与永久删除。
- Monaco Markdown 编辑、GFM 表格、KaTeX、Mermaid、图片和即时预览。
- 结构化实验信息生成大纲；AI 重写／扩写／格式化先预览再确认套用。
- AI 输出数字与单位完整性检查；修改原始实验数值时拒绝套用。
- 报告完整度检查，包含章节、单位、图表标题／正文引用、参考资料、占位符与结论依据。
- Word（FastAPI + Pandoc）和浏览器 PDF 导出。
- 公开只读报告与按 Email 邀请的 view/edit 协作者模型。
- 私有报告图片与短期 signed URL。

Closed Beta 默认关闭：

- Stripe 计费
- GitHub 登录与 Repo 同步
- Google Drive 导入
- 浏览器扩充功能
- 录屏
- Yjs 实时协作
- 所有服务器端 Python 执行

这些入口只有在前后端对应 feature flag 都明确设为 true 后才可开放。关闭中的功能不属于本轮验收范围。

## 学生自己的 AI

除了内建 AI（需要登录），学生也可以用自己已有的 AI，不耗额度：

- **复制／粘贴**：把 prompt 复制到 ChatGPT、Claude、Gemini、DeepSeek、Kimi 等（网页或桌面版），再把回答贴回来；与内建 AI 走同一套数字完整性检查。
- **终端机 bridge**（`frontend/public/bridge/autolabreport-bridge.mjs`）：学生在自己电脑上执行，页面把 Agent 任务交给已登录的 Claude Code、Codex 或 Gemini CLI，可选模型。
- **MCP 连接器**（`frontend/public/mcp/autolabreport-mcp.mjs`）：注册到 Claude Desktop、Claude Code、ChatGPT 桌面版或 Codex 后，学生直接在这些 AI app 里下指令；AI 可以列出、打开、读取、检查、新建和修改报告，并插入本机图片，上网搜索等则由 AI app 自己完成。修改都在页面的编辑器里执行：第一次修改前自动备份版本，可用 Ctrl+Z 复原。

- **ChatGPT 网页版**（`backend/mcp_remote.py`，端点 `/mcp`）：网页版只能连云端 MCP。登录走 Supabase OAuth 2.1，学生在 `/oauth/consent` 同意后，AI 以学生本人的身份（RLS）读写云端报告；每次修改前备份版本，并且只写在 AI 读到的那个版本上。页面会发现别处保存的新版本：没有未存修改时直接显示，否则把对方版本存入版本历史、保留学生的修改。需要项目所有者先开启 OAuth server（见 `docs/OWNER_ACTIONS.md`）。

两个本机程序都只监听 127.0.0.1，只接受 `https://autolabreport.lucirel.com` 的 Origin 与 127.0.0.1／localhost 的 Host，而且必须先用配对码配对（输错多次会锁定）。两者都是零依赖的单一文件，需要 Node.js 18 以上。

## 安全基线

- Markdown 中的 Python 代码块只显示，不在 API 进程执行。
- 文档写入以拥有者或明确的 Email 编辑协作者为准；公开链接始终只读。
- profiles 的方案、额度、Stripe 与集成字段不能由浏览器自行修改。
- AI 额度通过 service-role RPC 原子预留／退回。
- report_images 与 report_recordings bucket 为私有。
- 登录账号、访客草稿、保存 outbox 与 Yjs 缓存使用隔离命名空间。
- CORS 使用明确 allowlist；生产环境不会回退到学生电脑的 localhost。

必须在目标 Supabase 环境按文件名顺序应用全部迁移，直到：

~~~text
supabase/migrations/20260912_template_imitation_presets.sql
~~~

在未完成 staging 迁移验证前，不应邀请 Beta 用户。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Frontend | React 19、TypeScript、Vite 8、Tailwind CSS、Monaco |
| Preview | react-markdown、GFM、KaTeX、Mermaid |
| Auth / Data | Supabase Auth、Postgres、Storage、RLS |
| Backend | FastAPI、Pandoc、Groq／Gemini、Stripe（关闭） |
| Export | Pandoc DOCX、html2pdf.js PDF |
| Optional | Hocuspocus／Yjs collaboration、Chrome extension（均关闭） |

## 本机启动

复制根目录 .env.example，把前端变量放入 frontend/.env.local，后端变量放入 backend/.env。不要提交真实密钥。

后端：

~~~powershell
cd D:\AutoLabReport\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
~~~

前端：

~~~powershell
cd D:\AutoLabReport\frontend
npm install
npm run dev
~~~

常用验证：

~~~powershell
cd D:\AutoLabReport\frontend
npm run typecheck
npm run lint
npm test -- --run
npm run build
npx playwright test

cd D:\AutoLabReport\backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m py_compile main.py

cd D:\AutoLabReport
npm run check:local
npm run audit:prod
git diff --check
~~~

`npx playwright test` 会自己带起前端与**真实后端**（Word／PDF 导出要用到 Pandoc，不是 mock），因此依赖上面那步建好的 `backend\.venv`；找不到时会退回系统 `python`，CI 正是这样跑的。本机若没建 venv，只有导出相关的用例会超时失败，看起来像导出坏了，其实是环境没装。

`check:local` 會執行各服務的靜態檢查、測試與正式建置，不要求本機已填入部署密鑰或正在運行後端。`check:deploy` 另會嚴格檢查目標環境變數與後端 health／readiness，應在 staging 或 production preflight 使用。

## 运行状态

- GET /api/health 只说明进程可响应。
- GET /api/readiness 检查 Supabase、加密密钥与 Pandoc；缺少必要配置时返回 503。
- 至少配置 Groq 或 Gemini 之一，内建 AI 才可供 Beta 使用。

## 项目结构

~~~text
backend/                 FastAPI、AI、Word 导出与安全测试
frontend/                React 工作区与前端测试
frontend/public/bridge/  学生本机执行的终端机 bridge
frontend/public/mcp/     学生本机的 MCP 连接器（由 AI app 启动）
supabase/                基础 schema 与按日期排序的迁移
collaboration-server/    默认关闭的 Hocuspocus 服务
extension/               Closed Beta 默认关闭的浏览器扩充
docs/product/            产品规范、需求矩阵、Backlog、发布判断
docs/OWNER_ACTIONS.md    需要项目所有者在外部平台完成的事项
artifacts/closed-beta/   本机 QA 导出、渲染页与截图（不提交）
~~~

## 发布资料

- [产品规范](docs/product/PRODUCT_SPEC.md)
- [需求矩阵](docs/product/REQUIREMENTS_MATRIX.md)
- [Beta Backlog](docs/product/BETA_BACKLOG.md)
- [发布就绪判断](docs/product/RELEASE_READINESS.md)
- [Owner Actions](docs/OWNER_ACTIONS.md)
- [部署说明](docs/DEPLOYMENT.md)

目前建议结论为 **READY WITH OWNER ACTIONS**：代码层 Closed Beta 基线已建立，但仍必须由项目所有者在 staging 完成 Supabase 迁移、OAuth、生产环境变量、AI provider 和真实账号验收。不要跳过这些步骤直接开放给学生。

## License

当前为私有产品原型。公开分发前请补充正式 License。
