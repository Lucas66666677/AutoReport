import { useEffect, useState } from 'react'
import type { AuthOAuthServerApi, OAuthAuthorizationDetails, Provider, User } from '@supabase/supabase-js'
import { BrandMark } from './Brand'
import { describeRedirect } from './oauthConsent'

type OAuthConsentApi = Pick<AuthOAuthServerApi, 'getAuthorizationDetails' | 'approveAuthorization' | 'denyAuthorization'>

type OAuthConsentPageProps = {
  authorizationId: string | null
  user: User | null
  authMessage: string | null
  oauth: OAuthConsentApi | null
  onOAuthLogin: (provider: Provider) => void
  onSendMagicLink: (email: string) => Promise<boolean>
  onSignOut: () => void
  /** Whether the database confines AI apps to report content (see mcp_remote.py). */
  limitsActive?: boolean
  navigate?: (url: string) => void
}

type Stage =
  | { name: 'loading' }
  | { name: 'ready'; details: OAuthAuthorizationDetails }
  | { name: 'error'; message: string }
  | { name: 'leaving' }

const goTo = (url: string) => window.location.assign(url)

const PRIMARY =
  'h-11 w-full rounded-xl bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50'
const SECONDARY =
  'h-11 w-full rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Where a student decides whether an AI app -- ChatGPT on the web -- may reach their
 * AutoLabReport account (Supabase Auth's OAuth 2.1 server sends them here). The app gets
 * a token with the student's own permissions, so the page says so plainly, shows where
 * approving sends them, and makes them confirm an app AutoLabReport does not know.
 */
export function OAuthConsentPage({
  authorizationId,
  user,
  authMessage,
  oauth,
  onOAuthLogin,
  onSendMagicLink,
  onSignOut,
  limitsActive = false,
  navigate = goTo,
}: OAuthConsentPageProps) {
  const [stage, setStage] = useState<Stage>({ name: 'loading' })
  const [busy, setBusy] = useState(false)
  const [confirmedUnknownApp, setConfirmedUnknownApp] = useState(false)
  const [email, setEmail] = useState('')
  const [linkSent, setLinkSent] = useState(false)

  useEffect(() => {
    if (!user || !authorizationId || !oauth) return
    let cancelled = false
    oauth
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setStage({ name: 'error', message: '這個授權要求已經失效或不存在。請回到 AI app，重新連接 AutoLabReport。' })
        } else if ('redirect_url' in data) {
          // Approved before: straight back to the app.
          setStage({ name: 'leaving' })
          navigate(data.redirect_url)
        } else {
          setStage({ name: 'ready', details: data })
        }
      })
      .catch(() => {
        if (!cancelled) setStage({ name: 'error', message: '暫時無法讀取授權要求，請重新整理頁面再試。' })
      })
    return () => {
      cancelled = true
    }
  }, [user, authorizationId, oauth, navigate])

  async function decide(approve: boolean) {
    if (!authorizationId || !oauth) return
    setBusy(true)
    try {
      const { data, error } = approve
        ? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
      if (error || !data?.redirect_url) throw new Error(error?.message ?? '沒有收到回傳網址')
      setStage({ name: 'leaving' })
      navigate(data.redirect_url)
    } catch (err) {
      setBusy(false)
      setStage({ name: 'error', message: `無法完成：${err instanceof Error ? err.message : '未知錯誤'}` })
    }
  }

  let body: React.ReactNode
  if (!authorizationId) {
    body = (
      <>
        <h1 id="consent-title" className="text-lg font-semibold text-slate-950">
          授權連結不完整
        </h1>
        <p className="text-sm leading-6 text-slate-600">請回到 AI app，重新連接 AutoLabReport。</p>
      </>
    )
  } else if (!oauth) {
    body = (
      <>
        <h1 id="consent-title" className="text-lg font-semibold text-slate-950">
          目前無法處理授權
        </h1>
        <p className="text-sm leading-6 text-slate-600">AutoLabReport 的登入服務沒有設定完成，請稍後再試。</p>
      </>
    )
  } else if (!user) {
    body = (
      <>
        <h1 id="consent-title" className="text-lg font-semibold text-slate-950">
          登入 AutoLabReport
        </h1>
        <p className="text-sm leading-6 text-slate-600">
          有 AI app 想要連接你的 AutoLabReport 帳號。請先登入，登入後會回到這裡，由你決定是否允許。
        </p>
        <button type="button" onClick={() => onOAuthLogin('google')} className={PRIMARY}>
          用 Google 登入
        </button>
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault()
            if (await onSendMagicLink(email.trim())) setLinkSent(true)
          }}
        >
          <label className="block text-xs font-semibold text-slate-700">
            或用 Email 登入
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <button type="submit" className={SECONDARY}>
            寄登入連結
          </button>
        </form>
        {linkSent && (
          <p className="text-xs leading-5 text-slate-600">已寄出登入連結。請在這個瀏覽器打開信裡的連結，登入後會回到這裡。</p>
        )}
        {authMessage && (
          <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800 ring-1 ring-rose-200">
            {authMessage}
          </p>
        )}
      </>
    )
  } else if (stage.name === 'loading') {
    body = <p className="text-sm text-slate-500">正在讀取授權內容…</p>
  } else if (stage.name === 'leaving') {
    body = <p className="text-sm text-slate-500">正在回到 AI app…</p>
  } else if (stage.name === 'error') {
    body = (
      <>
        <h1 id="consent-title" className="text-lg font-semibold text-slate-950">
          無法完成授權
        </h1>
        <p role="alert" className="text-sm leading-6 text-rose-800">
          {stage.message}
        </p>
      </>
    )
  } else {
    const { details } = stage
    const { host, known } = describeRedirect(details.redirect_uri)
    const appName = details.client.name?.trim() || host
    body = (
      <>
        <h1 id="consent-title" className="text-lg font-semibold leading-7 text-slate-950">
          「{appName}」想要連接你的 AutoLabReport 帳號
        </h1>
        <p className="text-xs leading-5 text-slate-500">
          登入身分：{details.user.email || user.email}{' '}
          <button type="button" onClick={onSignOut} className="font-semibold text-slate-700 underline underline-offset-2">
            不是你？登出
          </button>
        </p>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 ring-1 ring-slate-200">
          <p className="font-semibold text-slate-900">連接後，它可以透過 AutoLabReport 的工具：</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>列出、讀取你的報告</li>
            <li>建立報告、修改報告內容（每次修改前會自動備份，可以在版本歷史還原）</li>
          </ul>
        </div>
        <p className="text-xs leading-5 text-slate-600">
          {limitsActive
            ? '它只能讀取、建立報告和修改報告內容：不能刪除、分享或搬移報告，也碰不到你的其他資料。請只允許你信任、而且是你自己設定的 AI app。'
            : '這個授權的權限等同你登入 AutoLabReport，請只允許你信任、而且是你自己設定的 AI app。'}
        </p>
        <p className="text-sm text-slate-700">
          允許後會回到：<strong className="font-semibold text-slate-950">{host}</strong>
        </p>
        {!known && (
          <div className="space-y-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 ring-1 ring-amber-200">
            <p className="font-semibold">這不是 AutoLabReport 認識的 AI app。除非這是你自己設定的，否則請按拒絕。</p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={confirmedUnknownApp}
                onChange={(event) => setConfirmedUnknownApp(event.target.checked)}
              />
              這是我自己設定的 AI app
            </label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void decide(false)} disabled={busy} className={SECONDARY}>
            拒絕
          </button>
          <button type="button" onClick={() => void decide(true)} disabled={busy || (!known && !confirmedUnknownApp)} className={PRIMARY}>
            允許
          </button>
        </div>
      </>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FAFAFC] px-4 py-10">
      <section aria-labelledby="consent-title" className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <BrandMark size="default" />
        {body}
      </section>
    </main>
  )
}
