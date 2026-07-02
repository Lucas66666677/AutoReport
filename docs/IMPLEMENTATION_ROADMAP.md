# AutoLabReport 功能落地路线图

這份文件把目前 UI 上的功能拆成「你需要到第三方後台完成」和「工程端需要實作」兩部分。優先順序是先讓核心寫作、雲端儲存、AI、分享與匯出穩定，再做商業化與高級協作。

## 0. Supabase 基礎

你要做：

1. 建立 Supabase project。
2. 到 SQL Editor 執行 `supabase/schema_and_rls.sql`。
3. 到 Auth Providers 開啟 Google、GitHub、Email magic link。
4. 把本機和部署網址加入 Auth redirect URLs。
5. 確認 Storage bucket `report_images` 存在且為 Public。

工程已做：

- `profiles`、`documents`、`document_collaborators`、`user_ai_settings`、`report_templates`、`ai_usage_logs` schema。
- `report_images` bucket 建立 SQL 和 Storage policies。
- AI 配額欄位統一為 `ai_daily_used`、`ai_daily_reset_at`。

## 1. 圖片貼上與雲端儲存

你要做：

1. 到 Supabase Storage 確認 `report_images` bucket 是 Public。
2. 如果 SQL 沒自動建立，手動建立同名 bucket。
3. 確認 Storage policies 允許 authenticated user 在自己 user id 資料夾下 insert/update/delete，並允許 public read。

工程已做：

- 編輯器貼上圖片時優先上傳到 `report_images`。
- 圖片路徑格式：`{userId}/{documentId}/{timestamp}-{uuid}.{ext}`。
- 插入 Markdown public URL。
- 如果未登入或上傳失敗，保留 base64 fallback。

## 2. AI Assist 與 AI Agent

你要做：

1. 在 `backend/.env` 或部署環境設定：
   - `ENCRYPTION_KEY`
   - `GROQ_API_KEY`
   - `GROQ_MODELS`
   - `GEMINI_API_KEY`
   - `GEMINI_MODELS`
2. 免費模型用逗號分隔，順序就是 fallback 順序。
3. 決定 Free / Pro 每日 AI 額度。

工程已做：

- `/api/ai/run` 支援 built-in、extension、user API key。
- `/api/agent/run` 支援報告審閱、補全、格式整理、圖表、提交前檢查、多步寫作。
- built-in AI 使用 Groq model list，再 fallback 到 Gemini model list。
- AI quota 和 usage log 基礎流程。

工程已做：

1. User API key 透過 `/api/keys/save` 在後端 Fernet 加密後存入 `user_ai_settings.api_key_encrypted`。
2. `/api/ai/run` 與 `/api/agent/run` 在自備 Key 模式下只從後端讀取並解密，不再接收前端明文 key。
3. 前端安全儲存成功後會清空輸入框，localStorage 不保存 key。

後續工程：

1. 增加 AI timeout、重試策略和錯誤分類。
2. Agent 修改改成 diff preview，而不是只顯示完整 Markdown。

## 3. 文檔工作區

你要做：

1. 決定文件夾是否允許多層嵌套。
2. 決定刪除後保留多久。
3. 決定 guest 文件登入後是否自動遷移。

工程現況：

- Supabase-backed document CRUD。
- guest localStorage fallback。
- favorite、trash、folder 基礎流程。

後續工程：

1. 批量移動、批量刪除、排序。
2. guest to account migration。
3. 更清楚的空狀態和同步錯誤提示。

## 4. 匯出

你要做：

1. 本機或 Render 後端安裝 Pandoc。
2. 決定 Word 模板格式、頁首頁尾、字體。

工程現況：

- Word 透過 FastAPI + Pandoc 匯出。
- PDF 由前端 preview 直接輸出。

後續工程：

1. Word reference docx 模板。
2. PDF 分頁 QA。
3. 圖片、公式、表格的匯出一致性測試。

## 5. 分享與協作

你要做：

1. 決定分享權限規則：private、view、edit 是否足夠。
2. 決定協作者邀請是否要發 email。
3. 決定是否要自建 Yjs WebSocket server。

工程現況：

- share link、view/edit 權限基礎流程。
- collaborator email list。
- Yjs + WebRTC prototype。

後續工程：

1. 協作者邀請 email。
2. 權限審計 log。
3. Yjs persistence 和可靠信令。

## 6. 模板中心與 Prompt Library

你要做：

1. 決定官方模板分類。
2. 決定社群模板是否需要審核。
3. 提供預設 prompt 文案。

工程現況：

- 本地模板和 prompt library 基礎 UI。
- Supabase `report_templates` schema。

後續工程：

1. 模板 CRUD 接 Supabase。
2. 社群公開/下架/使用次數。
3. Prompt library 匯入匯出和雲端同步。

## 7. Billing / Pro

你要做：

1. 註冊 Stripe。
2. 建立 Product 和 Price。
3. 提供 `STRIPE_SECRET_KEY`、`STRIPE_PRO_PRICE_ID`、`STRIPE_WEBHOOK_SECRET`。
4. 設定 webhook endpoint：`https://你的後端網域/api/stripe/webhook`。
5. 在 Customer Portal settings 啟用訂閱取消/更新。

工程已做：

1. Checkout session endpoint。
2. Customer portal session endpoint。
3. Stripe webhook 更新 `profiles.plan`、`subscription_status`、`stripe_subscription_id`、`stripe_price_id`。
4. 前端 Billing 頁串接 checkout 和 portal。

後續工程：

1. 增加 webhook 重放/冪等處理。
2. 顯示更完整的訂閱狀態和下次付款日。
3. Pro 功能開關細化。

## 8. Google Drive / GitHub / 公開頁 / 錄製 / 團隊

你要做：

1. Google Drive：建立 Google Cloud OAuth Client，決定 Drive scope。
2. GitHub：建立 GitHub OAuth App，決定同步到 repo、gist 或單檔。
3. 公開頁：決定公開頁是否 SEO、是否顯示作者。
4. 錄製：決定錄製螢幕、編輯過程或講解。
5. 團隊：決定 workspace、角色、計費歸屬。

工程後續：

1. OAuth callback 和 token 儲存。
2. Drive export/sync。
3. GitHub commit/conflict flow。
4. Public route、theme、view count 已有基礎版：`/p/{documentId}`。
5. MediaRecorder 或第三方錄製服務。
6. Team schema、RLS、成員管理。

## 建議里程碑

第一階段，可用：

1. Supabase schema + Auth + Storage。
2. 文件 CRUD、AI、Agent、圖片、Word/PDF、分享。
3. 跑 `scripts/deploy-check.ps1 -RunBuild`。

第二階段，可發布：

1. Stripe。
2. 模板雲端化。
3. 錯誤監控。
4. 插件穩定性。

第三階段，高級功能：

1. Drive / GitHub。
2. Team workspace。
3. 生產級協作。
4. 公開頁和錄製。
