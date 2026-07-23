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

## 安全基线

- Markdown 中的 Python 代码块只显示，不在 API 进程执行。
- 文档写入以拥有者或明确的 Email 编辑协作者为准；公开链接始终只读。
- profiles 的方案、额度、Stripe 与集成字段不能由浏览器自行修改。
- AI 额度通过 service-role RPC 原子预留／退回。
- report_images 与 report_recordings bucket 为私有。
- 登录账号、访客草稿、保存 outbox 与 Yjs 缓存使用隔离命名空间。
- CORS 使用明确 allowlist；生产环境不会回退到学生电脑的 localhost。

必须在目标 Supabase 环境应用全部迁移，尤其是：

~~~text
supabase/migrations/20260723_closed_beta_security.sql
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

cd D:\AutoLabReport\backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m py_compile main.py

cd D:\AutoLabReport
npm run check:deploy
git diff --check
~~~

## 运行状态

- GET /api/health 只说明进程可响应。
- GET /api/readiness 检查 Supabase、加密密钥与 Pandoc；缺少必要配置时返回 503。
- 至少配置 Groq 或 Gemini 之一，内建 AI 才可供 Beta 使用。

## 项目结构

~~~text
backend/                 FastAPI、AI、Word 导出与安全测试
frontend/                React 工作区与前端测试
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
