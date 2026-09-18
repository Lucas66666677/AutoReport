import { describe, expect, it } from 'vitest'
import { modelOptionsFor, normalizeModelChoice, type AiModels } from './modelChoice'

const MODELS: AiModels = {
  built_in: [
    { id: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile（Groq）' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash（Gemini）' },
  ],
  own_key_provider: 'gemini',
  own_key_live: true,
  own_key_models: [
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
  ],
  own_key_default: 'gemini-2.5-flash',
}

describe('normalizeModelChoice', () => {
  // These came from the old fixed list and no provider has ever accepted them.
  it('clears names that were never valid anywhere', () => {
    for (const value of ['gemini-flash', 'user-api-model', 'claude-sonnet-4', 'deepseek-r1']) {
      expect(normalizeModelChoice(value)).toBe('')
    }
  })

  it('keeps a real model id, which may be exactly what the key can use', () => {
    expect(normalizeModelChoice('gpt-4.1')).toBe('gpt-4.1')
    expect(normalizeModelChoice(' gemini-2.5-pro ')).toBe('gemini-2.5-pro')
  })

  it('treats anything that is not a string as 自動', () => {
    expect(normalizeModelChoice(undefined)).toBe('')
    expect(normalizeModelChoice(null)).toBe('')
  })
})

describe('modelOptionsFor', () => {
  it('offers built-in AI’s configured models, not the old fixed list', () => {
    const { options } = modelOptionsFor('built_in', MODELS, '')
    expect(options.map((option) => option.value)).toEqual(['', 'llama-3.3-70b-versatile', 'gemini-2.5-flash'])
    expect(options.map((option) => option.label).join()).not.toContain('GPT-4.1')
  })

  it('offers what the student’s own key can use, and names the model 自動 would pick', () => {
    const { options, note } = modelOptionsFor('user_api_key', MODELS, '')
    expect(options[0].label).toBe('自動（目前是 gemini-2.5-flash）')
    expect(options.map((option) => option.value)).toContain('gemini-2.5-pro')
    expect(note).toBeNull()
  })

  it('says when the list is a suggestion because the provider could not be asked', () => {
    const { note } = modelOptionsFor('user_api_key', { ...MODELS, own_key_live: false }, '')
    expect(note).toContain('暫時無法向廠商查詢')
  })

  it('explains what to do before a key is saved', () => {
    const { options, note } = modelOptionsFor('user_api_key', { ...MODELS, own_key_provider: null, own_key_models: [] }, '')
    expect(options).toEqual([{ value: '', label: '自動' }])
    expect(note).toContain('儲存 API Key')
  })

  // A saved choice missing from the list used to show as 自動 while still being sent.
  it('shows a saved choice that is not available as exactly that, with a warning', () => {
    const { options, note } = modelOptionsFor('user_api_key', MODELS, 'gpt-4.1')
    expect(options.at(-1)).toEqual({ value: 'gpt-4.1', label: 'gpt-4.1（不在目前可用的清單上）' })
    expect(note).toContain('gpt-4.1')
  })

  it('lets the extension decide its own model', () => {
    expect(modelOptionsFor('extension', MODELS, '').options).toHaveLength(1)
  })

  it('still offers 自動 before the list has loaded', () => {
    expect(modelOptionsFor('built_in', null, '').options).toEqual([{ value: '', label: '自動（依站方設定的順序）' }])
  })
})
