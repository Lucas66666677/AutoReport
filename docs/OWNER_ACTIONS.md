# Owner Actions

Updated: 2026-07-23

不要把真实 Secret 写入本文件、聊天、截图或 Git；请直接填入平台的加密环境变量界面。

| 平台 | 要做什么 | 控制台位置 | 所需值 | 为什么 | 如何验证 | 是否阻塞 Beta |
|---|---|---|---|---|---|---|
| Supabase Database | 在干净 staging 依序执行 schema 与全部 migration，最后执行 20260723_closed_beta_security.sql | SQL Editor／Migration 管理 | 无真实 Secret；使用仓库 SQL | 建立 RLS、trigger、quota RPC 与私有 Storage | 完成下方三账号权限矩阵 | 是 |
| Supabase Auth URL | 配置正式与 staging URL | Authentication → URL Configuration | Site URL、允许的 redirect URL | OAuth／Magic Link 必须回到正确网站 | 两个域名登录后不循环、不跳错站 | 是 |
| Supabase Email | 启用 Magic Link 与邮件模板 | Authentication → Providers → Email | 发件设置、模板、redirect | Google 故障时仍能登录 | Beta 邮箱收到链接并完成登录 | 若承诺 Email 则是 |
| Google OAuth | 发布或配置测试用户；填入 Supabase provider | Google Cloud → OAuth consent screen／Credentials；Supabase → Providers → Google | Client ID、Client Secret、Supabase callback URI、授权域名 | 解决 403 access_denied 并提供主要登录 | 非项目拥有者账号成功登录／登出／重登 | 若承诺 Google 则是 |
| Google Cloud Billing | 只在另一个 Google API 明确要求时关联 Billing | Google Cloud → Billing | 结算账号（通常基本 OAuth 登录不需要） | 避免把无关警示误当 OAuth 阻塞 | Drive 关闭时基本登录仍成功 | 否 |
| Supabase Storage | 确认 report_images 与 report_recordings 为 private，并执行 policies | Storage → Buckets／Policies | 两个 bucket 名与仓库 policy | 防止实验图片和录屏被公开枚举 | 未授权读取失败；授权 signed URL 成功 | 是 |
| Groq | 配置至少一个内建 AI provider | Groq Console → API Keys；Render Env | GROQ_API_KEY、GROQ_MODEL(S) | 提供内建 AI | 大纲与改写各成功一次；额度只扣一次 | Groq／Gemini 至少一个是 |
| Gemini | 配置至少一个内建 AI provider | Google AI Studio／Cloud；Render Env | GEMINI_API_KEY、GEMINI_MODEL(S) | 提供 Groq fallback 或主要 AI | 大纲与改写各成功一次；失败不泄露响应 | Groq／Gemini 至少一个是 |
| Google Drive scopes | 本轮保持关闭，不把 Drive scope 加到 Google 登录 | Google OAuth consent screen；Vercel／Render Env | VITE_ENABLE_GOOGLE_DRIVE=false、GOOGLE_DRIVE_ENABLED=false | 基本登录不应索取不必要的 Drive 权限 | Consent 只显示 openid／email／profile | 否；保持关闭 |
| Vercel | 配置前端环境变量与 feature flags | Project → Settings → Environment Variables | VITE_API_URL、Supabase URL／anon key；未验收 flags=false | 防止 localhost 回退与死入口 | Network 只请求正式 HTTPS；隐藏功能不出现 | 是 |
| Render | 配置后端 URL、Supabase service role、加密、CORS 与 flags | Service → Environment | SUPABASE_URL、SERVICE_ROLE、ENCRYPTION_KEY、FRONTEND_URL、BACKEND_URL、CORS allowlist | 后端认证写入、加密与跨域安全 | /api/readiness=200；恶意 Origin 被拒 | 是 |
| Pandoc | 安装并加入 PATH | Render Build／Dockerfile | 可执行 Pandoc 版本 | Word 导出依赖 | readiness pandoc=true；标准 DOCX 可打开 | 是 |
| Stripe | 本轮维持关闭，不建立真实收费 | Stripe Dashboard；Vercel／Render Env | 前后端 billing flags=false | 防止未验收收费入口 | UI 无升级入口；后端 route=503 | 否；保持关闭 |
| GitHub OAuth | GitHub 登录与 Sync 都维持关闭 | Supabase Providers／GitHub OAuth Apps；Env | VITE_ENABLE_GITHUB_AUTH=false、同步 flags=false | 避免未配置或缺 CSRF 验收的流程 | 登录页无 GitHub；sync route=503 | 否；保持关闭 |
| Collaboration server | 本轮不部署或保持拒绝连接 | 服务环境变量 | COLLABORATION_ENABLED=false | 避免 Yjs 与 HTTP 双写覆盖 | 前端不开连接；server 拒绝认证 | 否；保持关闭 |
| Error monitoring | 选择并配置 Sentry 或同类服务 | 监控平台项目设置／Vercel／Render | DSN、release tag、告警收件人；先做 PII 审查 | 20 位学生发生错误时 Owner 能主动发现 | staging 发送测试事件并收到告警 | 是 |
| Feedback | 指定学生可见的回报渠道与负责人 | Owner 选择的 Email／表单／群组 | 公开联系地址、负责人、响应时间 | 保存／登录／导出受阻时有升级路径 | 从应用入口发送测试消息并收到 | 是 |

## 三账号权限矩阵

使用三个 disposable staging 账号与一个未登录浏览器：

| 情境 | 预期 |
|---|---|
| Owner 新建、编辑、删除、恢复自己的报告 | 允许 |
| 账号 B 未受邀直接改 URL documentId | 拒绝 |
| 账号 B 为 Viewer | 可读；写入拒绝 |
| 账号 C 为 Editor | 只可更新 content；不能改 owner、title、share、trash 或权限 |
| Owner 开启公开 view | 未登录可读 |
| 数据库残留 legacy edit | 未登录仍只读 |
| Owner 把共享报告移入垃圾桶 | Viewer／Editor／Anonymous 都失去访问 |
| 浏览器直接修改 profile plan／quota／Stripe 字段 | 拒绝或值不变 |
| 未授权直接读取 report_images | 拒绝 |

## Closed Beta flags

~~~text
VITE_ENABLE_BILLING=false
VITE_ENABLE_GITHUB_AUTH=false
VITE_ENABLE_GITHUB_SYNC=false
VITE_ENABLE_GOOGLE_DRIVE=false
VITE_ENABLE_SCREEN_RECORDING=false
VITE_ENABLE_REALTIME_COLLABORATION=false
VITE_ENABLE_BROWSER_EXTENSION=false

STRIPE_BILLING_ENABLED=false
GITHUB_SYNC_ENABLED=false
GOOGLE_DRIVE_ENABLED=false
OWNERSHIP_TRANSFER_EMAIL_CONFIGURED=false

COLLABORATION_ENABLED=false
~~~

## 正常浏览器手动验收

1. 在 Chrome／Edge 以 390×844、768×1024、1024×768、1440×900 测试。
2. Guest 新建、编辑、刷新并确认报告仍存在。
3. Owner 跑完整云端 CRUD 与 offline／online 重试。
4. 跑结构化大纲、AI 改写、拒绝提案、套用提案与恢复版本。
5. 要求 AI 把 1.00 ms 改成 2.00 ms，确认后端拒绝。
6. 上传图片、刷新并确认 signed URL 仍可显示。
7. 完成上方权限矩阵。
8. 用标准 fixture 导出 Word／PDF，逐页检查中文、公式、图表、图片与分页。
9. Console 无未解释 warning／error；Network 无 localhost、token query string 或隐藏功能请求。
