# Closed Beta Requirements Matrix

Updated: 2026-07-23

| 功能 | 用户价值 | 前端 | 后端 | 数据库 | 权限 | 测试 | 浏览器验证 | 状态 | 缺口 |
|---|---|---|---|---|---|---|---|---|---|
| Guest 进入 | 无账号也能立即试写 | 有入口与本机警示 | 不需要 | localStorage v2 | 仅本机 | 前端回归 | 已进入 | Verified | 无 |
| Guest 刷新恢复 | 避免误以为草稿丢失 | 会话与文件恢复 | 不需要 | Guest key | 与账号缓存隔离 | 保存模块测试 | 编辑、刷新、恢复已通过 | Verified | 不自动迁移到注册账号，已明示 |
| Email Magic Link | Google 不可用时可登录 | 已实现 | Supabase Auth | Supabase | 由 Auth 控制 | 未做外部投递 | 未做真实邮箱 | Implemented but unverified | Owner 配置 |
| Google OAuth | 低摩擦登录 | 已实现，不请求 Drive | Supabase Auth | Supabase | 仅身份 scope | 未做外部 OAuth | 未做真实账号 | Implemented but unverified | Owner 配置／验证 |
| GitHub 登录 | 可选登录方式 | 默认隐藏 | Supabase Auth 可扩展 | Supabase | 未纳入本轮 | 无 | 无 | Out of Beta scope | 需单独 OAuth 验收 |
| 云端文件 CRUD | 登录后保存与重开 | 新建／打开／重命名／收藏 | Supabase client | documents | Owner RLS | 静态与类型测试 | 无 staging 账号 | Implemented but unverified | 真实 staging E2E |
| 文件夹 CRUD | 组织课程报告 | 建立／移动／树状删除 | Supabase client | documents parent_id | Owner RLS | 类型与构建 | 未做 staging | Implemented but unverified | 真实 staging E2E |
| 垃圾桶 | 防止误删 | 删除／恢复／永久删除 | Supabase client | is_trashed | Owner only | 类型与构建 | Guest 路径已看 | Implemented but unverified | 云端与 Storage 清理 E2E |
| 自动保存 | 避免内容丢失 | 500ms、序列化、状态提示 | Supabase update | documents | Editor content only | outbox tests | Guest 保存状态已看 | Verified | 云端断网 E2E 待补 |
| 离线 outbox | 网络失败后可恢复 | 保留最新版本与重试 | 重连后写入 | 每账号 localStorage | 用户隔离 | Vitest | 未做网络拦截 | Verified | 浏览器 offline／online P1 |
| 账号缓存隔离 | 防止换账号看到旧稿 | user id namespace | 不适用 | 本机 namespace | 账号隔离 | Vitest | 未做双账号 | Verified | staging 双账号复核 |
| Edit／Split／Preview | 核心写作体验 | 已实现 | render API | 不适用 | View-only 限制 | 既有＋本轮测试 | 1280 已通过 | Verified | 当前全视口复测待补 |
| GFM table | 数据表可读 | MarkdownRenderer | 原样传递 | 不适用 | sanitizer | 单元／构建 | 标准报告已看 | Verified | 无 |
| KaTeX | 显示公式 | 已实现 | 原样传递 | 不适用 | sanitizer | 构建 | 标准报告已看 | Verified | 无 |
| Mermaid | 显示流程图 | 已实现 | 原样传递 | 不适用 | strict securityLevel | 构建 | 标准报告已看 | Verified | Word 中只保留源码 |
| 报告图片 | 粘贴／上传实验截图 | 私有 marker 与 signed URL | 不经 API | private Storage | 文档读写者 | path tests | 本地图已看 | Implemented but unverified | staging signed URL E2E |
| 结构化大纲 | 从实验资料开始写 | 六类独立输入＋预览 | outline API | 不适用 | 登录／额度依配置 | 类型／构建 | 未调用外部 AI | Implemented but unverified | Owner AI provider |
| AI 改写／扩写／格式化 | 辅助写作但不覆盖 | 提案确认＋版本备份 | ai／agent API | versions 本机；额度 DB | Auth＋quota | 数值测试 | 外部 AI 未调用 | Implemented but unverified | provider E2E |
| AI 摘要／自定义 Prompt | 多种辅助任务 | 请求路径存在 | ai API | quota | Auth＋quota | 类型／构建 | 未调用 | Implemented but unverified | provider E2E |
| AI 数字保护 | 不篡改实验数值 | 显示失败 | 后端阻断 | 不适用 | 服务端强制 | 4 个安全测试 | 未调用 provider | Verified | 单位转换当前也会拒绝 |
| AI 配额 | 防滥用与成本失控 | 显示额度 | reserve／refund RPC | profiles＋RPC | service role only | SQL 静态审查 | 未做真实 DB | Implemented but unverified | clean staging 验证 |
| 报告质量检查 | 交作业前发现缺漏 | 15 项、位置／原因／建议 | 不需要 | 不适用 | 不修改内容 | Vitest | 标准报告面板已看 | Verified | 无 |
| 公开分享 | 助教免登录查看 | PublicReport 只读 | Supabase read | share_setting | public read only | SQL 静态测试 | 无公开 staging 文档 | Implemented but unverified | 匿名真实链接 E2E |
| Owner／Editor／Viewer | 小组分工 | 协作者管理 UI | Supabase | collaborators | RLS＋trigger | SQL 静态测试 | 无多账号 | Implemented but unverified | 三账号权限矩阵 |
| 公开 edit 旧链接 | 防匿名接管 | UI 不提供 | 不提供写 API | legacy 值仍可读 | 永远只读 | migration test | 未做 staging | Verified | staging 复核 |
| URL documentId 越权 | 防猜 ID | 错误提示 | Supabase | documents | RLS | SQL 审查 | 无 staging | Implemented but unverified | 真实直接 URL／API |
| Word 导出 | 可正式提交 | 下载入口 | Pandoc export | 不适用 | 代码不执行 | API smoke | Word 打开、4 页逐页检查 | Verified | Mermaid 未转图 |
| PDF 导出 | 可正式提交 | html2pdf 入口 | 不需要 | 不适用 | 预览内容 | build | 已触发但未取得下载文件 | Implemented but unverified | Chrome／Edge 下载逐页检查 |
| Public report 错误 | 不泄露数据库细节 | 通用错误 | Supabase read | 不适用 | 不回传 raw error | 构建 | 未做独立路由 | Implemented but unverified | staging 无效／私有链接 |
| 390／768／1024／1440 | 手机与桌面可操作 | 有响应式 classes | 不适用 | 不适用 | 不适用 | 构建 | 旧品牌截图有 390／1024／1440；本轮固定 1280 | Partial | 全旅程多视口手测 |
| Python 安全 | 代码块不能执行 | 仅显示 | 执行器已删除 | 不适用 | 服务端强制 | 3 个安全测试＋live API | render 已测 | Verified | 无 |
| CORS | 阻止非授权网页调用 | 生产 URL 明确 | allowlist | 不适用 | exact origin | 单元＋live preflight | evil origin 被拒 | Verified | 部署值需 Owner |
| Secret 保护 | 不泄露密钥 | 不存 localStorage | 泛化错误与安全日志 | encrypted field | service role | 模式扫描 | 未显示 secret | Verified | 需部署平台 secret 管理 |
| Profile 保护 | 用户不能改方案／额度 | 无直接入口 | service RPC | trigger | service fields protected | SQL 审查 | 无 staging | Implemented but unverified | clean DB 验证 |
| 私有 Storage | 防图片／录屏公开 | signed URL | 不适用 | buckets private | 文档权限 | migration tests | 无 staging | Verified | 真实 signed URL 复核 |
| Health／Readiness | 区分活着与可服务 | 部署检查调用 | 两个 endpoint | 配置检查 | 不泄密 | live API | health 200／readiness 503 fail-closed | Verified | staging 应为 200 |
| Clean DB 初始化 | 防迁移上线失败 | 不适用 | 不适用 | schema＋migrations | RLS | 无 Supabase CLI | 未做 | Blocked | Owner 提供 staging／CI |
| 错误监控 | 快速发现学生故障 | 未集成 | 未集成 | 未集成 | 需 PII 审查 | 无 | 无 | Not implemented | Owner 选择监控平台 |
| 反馈渠道 | 学生可报告问题 | 有入口 | 目的地未验证 | 不适用 | 不适用 | 无 | 未验证 | Partial | Owner 指定收件渠道 |
| Stripe | 正式收费 | 隐藏 | 503 disabled | 既有字段受保护 | 未开放 | disabled path | 未做 | Out of Beta scope | 后续单独验收 |
| Google Drive | 导入云端文件 | 隐藏 | 503 disabled；token 仅 POST body | 不适用 | 单独 scope | route test | 未做 | Out of Beta scope | 后续单独 consent |
| GitHub Sync | 同步 Repo | 隐藏 | 503 disabled | encrypted token | 未开放 | disabled path | 未做 | Out of Beta scope | 后续 state／redirect 审查 |
| 双人实时协作 | 同时编辑 | flag off | server default off | 不写入 | 拒绝连接 | node check | 未做 | Out of Beta scope | 需单一持久化策略 |
| 录屏／扩充功能 | 未来工具 | 隐藏 | 未开放 | recording private | 未开放 | 语法检查 | 未做 | Out of Beta scope | 后续安全与发布流程 |
