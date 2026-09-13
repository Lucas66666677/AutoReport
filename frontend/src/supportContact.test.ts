import { describe, expect, it } from 'vitest'
import { SUPPORT_EMAIL, buildSupportBody, buildSupportMailto } from './supportContact'

describe('support contact', () => {
  it('always has a recipient', () => {
    // The defect this replaces: mailto:?subject=... opened an empty composer, so the
    // student believed they had reported a problem that reached nobody.
    const mailto = buildSupportMailto()
    expect(mailto.startsWith('mailto:?')).toBe(false)
    expect(mailto).toContain(`mailto:${SUPPORT_EMAIL}`)
    expect(SUPPORT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
  })

  it('asks for what a report needs to be actionable', () => {
    const body = buildSupportBody({ release: 'abc1234', userAgent: 'TestBrowser/1.0', sentAt: '2026-09-13T00:00:00Z' })
    expect(body).toContain('發生什麼事')
    expect(body).toContain('我當時正在做什麼')
    expect(body).toContain('版本：abc1234')
    expect(body).toContain('瀏覽器：TestBrowser/1.0')
    expect(body).toContain('時間：2026-09-13T00:00:00Z')
  })

  it('leaves out technical lines it was given nothing for', () => {
    const body = buildSupportBody({ sentAt: '2026-09-13T00:00:00Z' })
    expect(body).not.toContain('版本：')
    expect(body).not.toContain('瀏覽器：')
  })

  it('encodes spaces so mail clients do not show a plus sign', () => {
    const mailto = buildSupportMailto({ sentAt: '2026-09-13T00:00:00Z' })
    expect(mailto).not.toContain('+')
    expect(mailto).toContain('%20')
  })

  it('carries the subject a reader can triage on', () => {
    expect(buildSupportMailto()).toContain('subject=AutoLabReport')
  })
})
