import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OAuthConsentPage } from './OAuthConsentPage'

// Vitest runs without globals here, so Testing Library cannot clean up by itself.
afterEach(cleanup)

const USER = { id: 'u1', email: 'student@example.edu' } as unknown as User

function details(redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect', name = 'ChatGPT') {
  return {
    authorization_id: 'auth-1',
    redirect_uri: redirectUri,
    client: { id: 'client-1', name, uri: '', logo_uri: '' },
    user: { id: 'u1', email: 'student@example.edu' },
    scope: 'openid email',
  }
}

function oauthApi(found: unknown = details()) {
  return {
    getAuthorizationDetails: vi.fn().mockResolvedValue({ data: found, error: null }),
    approveAuthorization: vi.fn().mockResolvedValue({ data: { redirect_url: 'https://chatgpt.com/cb?code=c&state=s' }, error: null }),
    denyAuthorization: vi.fn().mockResolvedValue({ data: { redirect_url: 'https://chatgpt.com/cb?error=access_denied' }, error: null }),
  }
}

function renderPage(overrides: Partial<Parameters<typeof OAuthConsentPage>[0]> = {}) {
  const props = {
    authorizationId: 'auth-1',
    user: USER,
    authMessage: null,
    oauth: oauthApi() as unknown as Parameters<typeof OAuthConsentPage>[0]['oauth'],
    onOAuthLogin: vi.fn(),
    onSendMagicLink: vi.fn().mockResolvedValue(true),
    onSignOut: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  }
  render(<OAuthConsentPage {...props} />)
  return props
}

describe('OAuthConsentPage', () => {
  it('names the app, the account, what it may do and where approving leads', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '「ChatGPT」想要連接你的 AutoLabReport 帳號' })).toBeTruthy()
    expect(screen.getByText(/student@example.edu/)).toBeTruthy()
    expect(screen.getByText(/權限等同你登入 AutoLabReport/)).toBeTruthy()
    expect(screen.getByText('chatgpt.com')).toBeTruthy()
  })

  // Once the database confines AI apps, the page can promise exactly that -- and not before.
  it('says what a grant allows only once the database enforces it', async () => {
    renderPage({ limitsActive: true })
    expect(await screen.findByText(/不能刪除、分享或搬移報告/)).toBeTruthy()
    expect(screen.queryByText(/權限等同你登入/)).toBeNull()
  })

  it('sends the student back to the app with the code when they approve', async () => {
    const props = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '允許' }))
    await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('https://chatgpt.com/cb?code=c&state=s'))
    const api = props.oauth as unknown as ReturnType<typeof oauthApi>
    expect(api.approveAuthorization).toHaveBeenCalledWith('auth-1', { skipBrowserRedirect: true })
  })

  it('sends them back with a refusal when they deny', async () => {
    const props = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '拒絕' }))
    await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('https://chatgpt.com/cb?error=access_denied'))
  })

  // Anyone can register an app called "ChatGPT"; where it sends the student gives it away.
  it('makes the student confirm an app AutoLabReport does not know', async () => {
    const props = renderPage({ oauth: oauthApi(details('https://evil.example/cb')) as never })
    const allow = await screen.findByRole('button', { name: '允許' })
    expect(screen.getByText('evil.example')).toBeTruthy()
    expect((allow as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('這是我自己設定的 AI app'))
    expect((allow as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(allow)
    await waitFor(() => expect(props.navigate).toHaveBeenCalled())
  })

  it('goes straight back when the student already approved this app', async () => {
    const props = renderPage({ oauth: oauthApi({ redirect_url: 'https://chatgpt.com/cb?code=again' }) as never })
    await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('https://chatgpt.com/cb?code=again'))
  })

  it('asks a signed-out student to sign in first, and does not look the request up', () => {
    const api = oauthApi()
    const props = renderPage({ user: null, oauth: api as never })
    fireEvent.click(screen.getByRole('button', { name: '用 Google 登入' }))
    expect(props.onOAuthLogin).toHaveBeenCalledWith('google')
    expect(api.getAuthorizationDetails).not.toHaveBeenCalled()
  })

  it('sends a sign-in link by e-mail', async () => {
    const props = renderPage({ user: null })
    fireEvent.change(screen.getByLabelText('或用 Email 登入'), { target: { value: ' student@example.edu ' } })
    fireEvent.click(screen.getByRole('button', { name: '寄登入連結' }))
    await waitFor(() => expect(props.onSendMagicLink).toHaveBeenCalledWith('student@example.edu'))
    expect(await screen.findByText(/已寄出登入連結/)).toBeTruthy()
  })

  it('explains an expired request and a broken link', async () => {
    renderPage({
      oauth: { ...oauthApi(), getAuthorizationDetails: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) } as never,
    })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/已經失效或不存在/)).toBeTruthy()
  })

  it('says so when the link has no authorization id', () => {
    renderPage({ authorizationId: null })
    expect(screen.getByRole('heading', { name: '授權連結不完整' })).toBeTruthy()
  })
})
