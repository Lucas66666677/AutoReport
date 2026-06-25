# AutoLabReport Launch Checklist

Use this checklist after Supabase SQL has returned `Success. No rows returned`.

## 1. Supabase

- Confirm these tables exist:
  - `profiles`
  - `documents`
  - `document_collaborators`
  - `user_ai_settings`
  - `ai_usage_logs`
- Confirm RLS is enabled on every table above.
- Enable Google OAuth and GitHub OAuth in Supabase Auth.
- Add deployed site URLs to Supabase Auth redirect URLs:
  - `https://your-vercel-domain.vercel.app`
  - `https://your-vercel-domain.vercel.app/editor/*`

## 2. Render Backend

Set environment variables:

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GROQ_API_KEY
GROQ_MODEL
GROQ_MODELS
GEMINI_API_KEY
GEMINI_MODEL
GEMINI_MODELS
FREE_DAILY_AI_QUOTA
PRO_DAILY_AI_QUOTA
STRIPE_SECRET_KEY
STRIPE_PRO_PRICE_ID
STRIPE_CUSTOMER_PORTAL_URL
```

Smoke test:

```powershell
Invoke-RestMethod https://your-render-backend.onrender.com/api/health
Invoke-RestMethod https://your-render-backend.onrender.com/keep-alive
Invoke-RestMethod https://your-render-backend.onrender.com/api/billing/config
```

## 3. Vercel Frontend

Set environment variables:

```txt
VITE_API_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Confirm `frontend/vercel.json` is included in the deployed frontend project so `/editor/:id` routes resolve to the SPA.

## 4. Product Smoke Test

- Open landing page.
- Sign in with Google.
- Create a report.
- Rename the report.
- Toggle favorite.
- Open AI settings.
- Generate outline with built-in AI.
- Confirm quota decreases.
- Share document as view-only.
- Open shared link in incognito.
- Confirm private documents are blocked for guests.
- Confirm view-only documents cannot be edited.
- Install extension locally and send one AI response back to the editor.

## 5. One-command Local Check

```powershell
.\scripts\deploy-check.ps1 -RunBuild
```

For deployed backend probes:

```powershell
.\scripts\deploy-check.ps1 -BackendUrl https://your-render-backend.onrender.com
```
