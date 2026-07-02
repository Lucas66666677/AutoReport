# Production collaboration server

AutoLabReport uses Hocuspocus v4 and Yjs. The collaboration service validates
every Supabase JWT before a document is synchronized.

## 1. Apply the database migration

Run `supabase/migrations/20260701_yjs_collaboration_persistence.sql` after the
workspace migration.

## 2. Configure the server

Copy `collaboration-server/.env.example` to `collaboration-server/.env` and set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS`
- `PORT`

Never expose the service-role key to Vite or the browser.

## 3. Start the service

```powershell
cd collaboration-server
npm install
npm start
```

The health endpoint is `http://localhost:1234/health`.

## 4. Configure the frontend

Set this locally:

```text
VITE_COLLABORATION_URL=ws://localhost:1234
```

Production must use `wss://`. Hocuspocus reconnects automatically, refreshes
the Supabase token every five minutes, and IndexedDB retains pending local Yjs
updates across temporary disconnects and page reloads.

## Authorization

Connections are writable only for:

- the legacy `documents.user_id` owner;
- workspace members with `owner` or `editor`;
- legacy document collaborators with `edit`.

Public `share_setting=edit` does not grant WebSocket access. Collaboration
requires an authenticated Supabase user.
