// Which models a student can choose, from what the server says is really available.
//
// The settings list used to be fixed: several names no provider accepts, the same list
// whatever the provider, and a "Pro" list of models built-in AI never had. Built-in AI
// ignored the choice, and an own key was sent whatever was picked. The server now
// reports built-in AI's configured models and what the student's own key can use
// (GET /api/ai/models), and this turns that into the options the page shows.

export type ModelOption = { id: string; label: string }

export type AiModels = {
  built_in: ModelOption[]
  own_key_provider: string | null
  own_key_live: boolean
  own_key_models: ModelOption[]
  own_key_default: string | null
}

export type ModelSelectOption = { value: string; label: string }

/**
 * Names the old fixed list offered that no provider has ever accepted. A saved one is
 * cleared to 自動 rather than sent. Real ids the old list also offered (gpt-4.1,
 * gemini-2.5-pro) are kept: they may be what the student's key can use, and if not
 * the page says so beside the choice.
 */
const NEVER_VALID_MODEL_VALUES = new Set(['gemini-flash', 'user-api-model', 'claude-sonnet-4', 'deepseek-r1'])

export function normalizeModelChoice(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return NEVER_VALID_MODEL_VALUES.has(trimmed) ? '' : trimmed
}

/** The options for the current provider, plus a note when the list needs explaining. */
export function modelOptionsFor(
  provider: 'built_in' | 'user_api_key' | 'extension',
  models: AiModels | null,
  saved: string,
): { options: ModelSelectOption[]; note: string | null } {
  let options: ModelSelectOption[]
  let note: string | null = null

  if (provider === 'extension') {
    return { options: [{ value: '', label: '由插件開啟的 AI 網站決定' }], note: null }
  }

  if (provider === 'built_in') {
    options = [{ value: '', label: '自動（依站方設定的順序）' }, ...(models?.built_in ?? []).map(toSelect)]
    if (models && models.built_in.length === 0) note = '內建 AI 目前沒有可選的模型。'
  } else if (!models?.own_key_provider) {
    options = [{ value: '', label: '自動' }]
    note = '安全儲存 API Key 後，這裡會列出這組 Key 能用的模型。'
  } else {
    const auto = models.own_key_default ? `自動（目前是 ${models.own_key_default}）` : '自動'
    options = [{ value: '', label: auto }, ...models.own_key_models.map(toSelect)]
    if (!models.own_key_live) note = '暫時無法向廠商查詢模型清單，以下是建議選項。'
  }

  // A saved choice the list no longer has is shown as what it is, not silently
  // displayed as 自動 while still being sent.
  if (saved && !options.some((option) => option.value === saved)) {
    options = [...options, { value: saved, label: `${saved}（不在目前可用的清單上）` }]
    note = `你目前選的「${saved}」不在這組設定可用的清單上，送出可能會失敗。建議改選清單中的模型或「自動」。`
  }

  return { options, note }
}

function toSelect(option: ModelOption): ModelSelectOption {
  return { value: option.id, label: option.label }
}
