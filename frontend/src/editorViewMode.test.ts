import { describe, expect, it } from 'vitest'
import {
  adjustSplitRatioWithKeyboard,
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
  EDITOR_SPLIT_RATIO_STORAGE_KEY,
  EDITOR_VIEW_MODE_STORAGE_KEY,
  getEffectiveEditorViewMode,
  getInitialEditorViewMode,
  getSplitRatioFromPointer,
  readStoredSplitRatio,
  shouldCollapseSplit,
} from './editorViewMode'

function createStorage(values: Record<string, string> = {}) {
  return {
    getItem(key: string) {
      return values[key] ?? null
    },
  }
}

describe('editor view mode state', () => {
  it('defaults to Split on desktop and Edit on a small screen', () => {
    expect(getInitialEditorViewMode(createStorage(), false)).toBe('split')
    expect(getInitialEditorViewMode(createStorage(), true)).toBe('edit')
  })

  it('restores valid saved modes and ignores invalid values', () => {
    expect(getInitialEditorViewMode(createStorage({ [EDITOR_VIEW_MODE_STORAGE_KEY]: 'preview' }), false)).toBe('preview')
    expect(getInitialEditorViewMode(createStorage({ [EDITOR_VIEW_MODE_STORAGE_KEY]: 'invalid' }), false)).toBe('split')
  })

  it('forces view-only documents into Preview', () => {
    expect(getEffectiveEditorViewMode('edit', false, false)).toBe('preview')
    expect(getEffectiveEditorViewMode('split', false, false)).toBe('preview')
  })

  it('collapses Split on narrow containers without changing the requested mode', () => {
    expect(shouldCollapseSplit(640)).toBe(true)
    expect(getEffectiveEditorViewMode('split', true, true)).toBe('edit')
    expect(getEffectiveEditorViewMode('split', true, false)).toBe('split')
  })
})

describe('split ratio calculations', () => {
  it('restores and clamps persisted ratios', () => {
    expect(readStoredSplitRatio(createStorage())).toBe(DEFAULT_SPLIT_RATIO)
    expect(readStoredSplitRatio(createStorage({ [EDITOR_SPLIT_RATIO_STORAGE_KEY]: '72' }))).toBe(72)
    expect(readStoredSplitRatio(createStorage({ [EDITOR_SPLIT_RATIO_STORAGE_KEY]: '99' }))).toBe(75)
  })

  it('calculates pointer ratios and respects pixel minimums', () => {
    expect(getSplitRatioFromPointer(500, 0, 1000)).toBe(50)
    expect(getSplitRatioFromPointer(-100, 0, 1000)).toBeCloseTo(32.6)
    expect(getSplitRatioFromPointer(1200, 0, 1000)).toBeCloseTo(67.4)
    expect(clampSplitRatio(50, 700)).toBe(50)
  })

  it('supports keyboard adjustment without crossing bounds', () => {
    expect(adjustSplitRatioWithKeyboard(50, 'ArrowLeft', 1000)).toBe(48)
    expect(adjustSplitRatioWithKeyboard(50, 'ArrowRight', 1000)).toBe(52)
    expect(adjustSplitRatioWithKeyboard(75, 'ArrowRight', 1000)).toBeCloseTo(67.4)
  })
})
