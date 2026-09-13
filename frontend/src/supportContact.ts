// Where a student reports a blocked save or export.
//
// docs/product/BETA_BACKLOG.md makes this a P0: "all 20 students know where to report
// a blocked save or export". The button that existed opened `mailto:?subject=...` with
// no recipient at all, so it raised an empty mail composer and the report reached
// nobody -- worse than no button, because the student believes they have reported it.
//
// The address is an operational detail, not a code one, so it is configurable: set
// VITE_SUPPORT_EMAIL to route Beta reports at a dedicated alias. The default is the
// address Lucirel already publishes on its own site, so a deployment that never sets
// the variable still reaches a real inbox instead of nowhere.

export const SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || 'hello@lucirel.com'

export type SupportContext = {
  release?: string
  userAgent?: string
  sentAt?: string
  /** What the person was doing, when the app knows -- never their content. */
  activity?: string
}

const SUBJECT = 'AutoLabReport 問題回報'

/**
 * A body the student can send as-is, and that says enough to act on.
 *
 * The technical block is appended visibly rather than hidden in a header: it is the
 * student's own mail client, so anything smuggled in would be a surprise. They can
 * read it and delete it before sending.
 */
export function buildSupportBody(context: SupportContext = {}): string {
  const lines = [
    '發生什麼事：',
    '（例如：按下匯出 Word 之後一直轉圈，等了兩分鐘沒有反應）',
    '',
    '我當時正在做什麼：',
    '',
    '',
    '--- 以下是自動附上的技術資訊，方便排查，可自行刪除 ---',
  ]

  if (context.activity) lines.push(`畫面：${context.activity}`)
  if (context.release) lines.push(`版本：${context.release}`)
  if (context.userAgent) lines.push(`瀏覽器：${context.userAgent}`)
  lines.push(`時間：${context.sentAt ?? new Date().toISOString()}`)

  return lines.join('\n')
}

export function buildSupportMailto(context: SupportContext = {}): string {
  const query = new URLSearchParams({
    subject: SUBJECT,
    body: buildSupportBody(context),
  })
  // URLSearchParams encodes a space as "+", which some mail clients show literally.
  return `mailto:${SUPPORT_EMAIL}?${query.toString().replace(/\+/g, '%20')}`
}

/** The context the browser can supply on its own. */
export function currentSupportContext(activity?: string): SupportContext {
  return {
    activity,
    release: import.meta.env.VITE_RELEASE as string | undefined,
    userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    sentAt: new Date().toISOString(),
  }
}
