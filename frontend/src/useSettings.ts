import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'

export type DefaultExportFormat = 'word' | 'pdf' | 'markdown'

export type NotePreferences = {
  editorFontSize: number
  editorLineHeight: number
  defaultExportFormat: DefaultExportFormat
  autoNumberFigures: boolean
  autoNumberTables: boolean
  compactPreview: boolean
}

export const DEFAULT_NOTE_PREFERENCES: NotePreferences = {
  editorFontSize: 16,
  editorLineHeight: 28,
  defaultExportFormat: 'word',
  autoNumberFigures: true,
  autoNumberTables: true,
  compactPreview: false,
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) return fallback
  return Math.max(min, Math.min(max, Math.round(numericValue)))
}

function normalizeExportFormat(value: unknown): DefaultExportFormat {
  return value === 'pdf' || value === 'markdown' || value === 'word' ? value : DEFAULT_NOTE_PREFERENCES.defaultExportFormat
}

export function normalizeNotePreferences(input: unknown): NotePreferences {
  const source = input && typeof input === 'object' ? (input as Partial<NotePreferences>) : {}

  return {
    editorFontSize: clampNumber(source.editorFontSize, DEFAULT_NOTE_PREFERENCES.editorFontSize, 12, 24),
    editorLineHeight: clampNumber(source.editorLineHeight, DEFAULT_NOTE_PREFERENCES.editorLineHeight, 20, 36),
    defaultExportFormat: normalizeExportFormat(source.defaultExportFormat),
    autoNumberFigures:
      typeof source.autoNumberFigures === 'boolean'
        ? source.autoNumberFigures
        : DEFAULT_NOTE_PREFERENCES.autoNumberFigures,
    autoNumberTables:
      typeof source.autoNumberTables === 'boolean'
        ? source.autoNumberTables
        : DEFAULT_NOTE_PREFERENCES.autoNumberTables,
    compactPreview:
      typeof source.compactPreview === 'boolean' ? source.compactPreview : DEFAULT_NOTE_PREFERENCES.compactPreview,
  }
}

export function useSettings({
  supabase,
  user,
  onError,
}: {
  supabase: SupabaseClient | null
  user: User | null
  onError?: (message: string) => void
}) {
  const [preferences, setPreferences] = useState<NotePreferences>(DEFAULT_NOTE_PREFERENCES)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const hasLoadedRef = useRef(false)
  const lastSavedJsonRef = useRef(JSON.stringify(DEFAULT_NOTE_PREFERENCES))
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let isCancelled = false
    hasLoadedRef.current = false

    if (!supabase || !user) {
      const timer = window.setTimeout(() => {
        if (isCancelled) return
        const defaults = normalizeNotePreferences(DEFAULT_NOTE_PREFERENCES)
        setPreferences(defaults)
        setIsLoading(false)
        setIsSaving(false)
        lastSavedJsonRef.current = JSON.stringify(defaults)
      }, 0)

      return () => {
        isCancelled = true
        window.clearTimeout(timer)
      }
    }

    void (async () => {
      setIsLoading(true)
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('preferences')
          .eq('id', user.id)
          .maybeSingle()
        if (isCancelled) return
        if (error) throw error

        const nextPreferences = normalizeNotePreferences(data?.preferences)
        setPreferences(nextPreferences)
        lastSavedJsonRef.current = JSON.stringify(nextPreferences)
        hasLoadedRef.current = true
      } catch (err) {
        if (isCancelled) return
        const message = err instanceof Error ? err.message : '偏好設定讀取失敗'
        onError?.(`偏好設定讀取失敗：${message}`)
        const defaults = normalizeNotePreferences(DEFAULT_NOTE_PREFERENCES)
        setPreferences(defaults)
        lastSavedJsonRef.current = JSON.stringify(defaults)
        hasLoadedRef.current = true
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [onError, supabase, user])

  useEffect(() => {
    if (!supabase || !user || !hasLoadedRef.current) return

    const normalizedPreferences = normalizeNotePreferences(preferences)
    const nextJson = JSON.stringify(normalizedPreferences)
    if (nextJson === lastSavedJsonRef.current) return

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      setIsSaving(true)
      void (async () => {
        try {
          const { error } = await supabase
            .from('profiles')
            .update({
              preferences: normalizedPreferences,
              updated_at: new Date().toISOString(),
            })
            .eq('id', user.id)
          if (error) throw error
          lastSavedJsonRef.current = nextJson
        } catch (err) {
          const message = err instanceof Error ? err.message : '偏好設定儲存失敗'
          onError?.(`偏好設定儲存失敗：${message}`)
        } finally {
          setIsSaving(false)
        }
      })()
    }, 700)

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [onError, preferences, supabase, user])

  const updatePreferences = useCallback((patch: Partial<NotePreferences>) => {
    setPreferences((currentPreferences) => normalizeNotePreferences({ ...currentPreferences, ...patch }))
  }, [])

  return useMemo(
    () => ({
      preferences,
      updatePreferences,
      isLoading,
      isSaving,
    }),
    [isLoading, isSaving, preferences, updatePreferences],
  )
}
