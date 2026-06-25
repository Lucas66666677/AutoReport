# AutoLabReport Deployment Guide

## Frontend: Vercel

Set these environment variables:

```txt
VITE_API_URL=https://your-render-backend.onrender.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

The SPA fallback is handled by `frontend/vercel.json`.

## Backend: Render

Set these environment variables:

```txt
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_MODELS=llama-3.3-70b-versatile,llama-3.1-8b-instant
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.0-flash
GEMINI_MODELS=gemini-2.0-flash,gemini-1.5-flash
FREE_DAILY_AI_QUOTA=3
PRO_DAILY_AI_QUOTA=300
STRIPE_SECRET_KEY=sk_test_your-stripe-secret-key
STRIPE_PRO_PRICE_ID=price_your-pro-plan-price-id
STRIPE_CUSTOMER_PORTAL_URL=https://billing.stripe.com/p/session/example
```

The backend exposes:

- `GET /api/health`
- `GET /keep-alive`
- `POST /api/render`
- `POST /api/generate-outline`
- `POST /api/ai/run`
- `GET /api/ai/quota`
- `GET /api/billing/config`
- `POST /api/export`
- `POST /api/export-pdf`

## Supabase

Run `supabase/schema_and_rls.sql` in the Supabase SQL Editor.

For OAuth login, enable Google and GitHub providers in Supabase Auth settings and configure the callback URL for your deployed domain.
