// Whether an AI feature can run right now, and if not, what to tell the student BEFORE
// they start.
//
// Students reported the AI features as "doing nothing". Measured on production as a
// guest: the AI Assist drawer showed a green 「內建 AI」 status; the Agent's run button
// was silently disabled on an empty report, so clicking it did nothing at all; and with
// content, a click waited 20 s (a cold start) or 3.8 s (warm) for the server to answer
// 401 「需要登入後使用」 in a toast that then faded. The page knew the answer the whole
// time -- whether anyone is signed in.
//
// Every AI request needs an account: built-in AI is metered per user, and an own API
// key is stored encrypted against the account, so the server refuses both for a guest.
// The browser extension is the one path that never touches the server.

export type AiProviderChoice = 'built_in' | 'user_api_key' | 'extension'

export type AiBlock = {
  title: string
  detail: string
  /** What the student can do about it right here, if anything. */
  action?: 'sign-in'
}

export type AiAvailabilityInput = {
  signedIn: boolean
  preferredProvider: AiProviderChoice
  /** Build flag: the extension is out of scope unless explicitly enabled. */
  extensionEnabled: boolean
  /** 'none' until the student saves a key in AI settings. */
  userApiProvider: string
  /** Built-in quota left today; null when unknown (signed out, or not loaded yet). */
  quotaRemaining: number | null
}

// Built-in AI and an own API key both need an account, but AI as a whole does not:
// a guest can carry the prompt to their own ChatGPT, Claude or Gemini (aiHandoff.ts).
export const SIGN_IN_BLOCK: AiBlock = {
  title: '內建 AI 需要登入後使用',
  detail: '每日額度記在帳號上，自備 API Key 也加密存在帳號裡。不想登入，也可以在任務中改用你自己的 ChatGPT、Claude、Gemini 等 AI。',
  action: 'sign-in',
}

export const EXTENSION_OFF_BLOCK: AiBlock = {
  title: '瀏覽器插件目前未開放',
  detail: '請到 AI 設定改用內建 AI 或自備 API Key。',
}

export const NO_API_KEY_BLOCK: AiBlock = {
  title: '尚未設定 API Key',
  detail: '請到 AI 設定選擇 API Provider 並安全儲存 API Key。',
}

export const QUOTA_BLOCK: AiBlock = {
  title: '今日內建 AI 額度已用完',
  detail: '每天台灣時間早上 8 點重置；也可以到 AI 設定改用自備 API Key。',
}

export const EMPTY_REPORT_BLOCK: AiBlock = {
  title: '報告目前是空的',
  detail: '先寫一些內容或貼上資料，Agent 才有東西可以處理。',
}

function serverBlock(input: AiAvailabilityInput, provider: 'built_in' | 'user_api_key'): AiBlock | null {
  if (!input.signedIn) return SIGN_IN_BLOCK
  if (provider === 'user_api_key' && input.userApiProvider === 'none') return NO_API_KEY_BLOCK
  if (provider === 'built_in' && input.quotaRemaining !== null && input.quotaRemaining <= 0) {
    return QUOTA_BLOCK
  }
  return null
}

/** AI Assist tasks, which honour the extension when it is enabled. */
export function assistBlock(input: AiAvailabilityInput): AiBlock | null {
  if (input.preferredProvider === 'extension') {
    return input.extensionEnabled ? null : EXTENSION_OFF_BLOCK
  }
  return serverBlock(input, input.preferredProvider)
}

/**
 * The Agent reads the whole report, so it always goes through the server: with the
 * extension selected it falls back to built-in AI, exactly as runAgentTask does.
 */
export function agentBlock(input: AiAvailabilityInput & { reportIsEmpty: boolean }): AiBlock | null {
  const provider = input.preferredProvider === 'extension' ? 'built_in' : input.preferredProvider
  return serverBlock(input, provider) ?? (input.reportIsEmpty ? EMPTY_REPORT_BLOCK : null)
}
