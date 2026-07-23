export type EditorViewMode = 'edit' | 'split' | 'preview'

export const EDITOR_VIEW_MODE_STORAGE_KEY = 'autoLabReport_editorViewMode'
export const EDITOR_SPLIT_RATIO_STORAGE_KEY = 'autoLabReport_editorSplitRatio'
export const DEFAULT_SPLIT_RATIO = 50
export const MIN_SPLIT_RATIO = 25
export const MAX_SPLIT_RATIO = 75
export const MIN_SPLIT_PANEL_WIDTH = 320
export const SPLIT_DIVIDER_WIDTH = 12

export function isEditorViewMode(value: unknown): value is EditorViewMode {
  return value === 'edit' || value === 'split' || value === 'preview'
}

export function getInitialEditorViewMode(
  storage: Pick<Storage, 'getItem'> | null,
  isSmallScreen: boolean,
): EditorViewMode {
  const savedMode = storage?.getItem(EDITOR_VIEW_MODE_STORAGE_KEY)
  if (isEditorViewMode(savedMode)) return savedMode
  return isSmallScreen ? 'edit' : 'split'
}

export function readStoredSplitRatio(storage: Pick<Storage, 'getItem'> | null): number {
  const rawValue = storage?.getItem(EDITOR_SPLIT_RATIO_STORAGE_KEY)
  if (rawValue === null || rawValue === undefined || rawValue.trim() === '') {
    return DEFAULT_SPLIT_RATIO
  }

  const storedValue = Number(rawValue)
  return Number.isFinite(storedValue)
    ? clampSplitRatio(storedValue)
    : DEFAULT_SPLIT_RATIO
}

export function clampSplitRatio(ratio: number, containerWidth = 0): number {
  const pixelMinimumRatio = containerWidth > 0
    ? ((MIN_SPLIT_PANEL_WIDTH + SPLIT_DIVIDER_WIDTH / 2) / containerWidth) * 100
    : MIN_SPLIT_RATIO
  const minimum = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, pixelMinimumRatio))
  const maximum = Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, 100 - pixelMinimumRatio))

  return Math.min(maximum, Math.max(minimum, ratio))
}

export function getSplitRatioFromPointer(
  pointerX: number,
  containerLeft: number,
  containerWidth: number,
): number {
  if (containerWidth <= 0) return DEFAULT_SPLIT_RATIO
  return clampSplitRatio(((pointerX - containerLeft) / containerWidth) * 100, containerWidth)
}

export function adjustSplitRatioWithKeyboard(
  ratio: number,
  key: string,
  containerWidth: number,
  step = 2,
): number {
  if (key === 'ArrowLeft') return clampSplitRatio(ratio - step, containerWidth)
  if (key === 'ArrowRight') return clampSplitRatio(ratio + step, containerWidth)
  return clampSplitRatio(ratio, containerWidth)
}

export function shouldCollapseSplit(containerWidth: number): boolean {
  return containerWidth > 0 && containerWidth < MIN_SPLIT_PANEL_WIDTH * 2 + SPLIT_DIVIDER_WIDTH
}

export function getEffectiveEditorViewMode(
  requestedMode: EditorViewMode,
  canEdit: boolean,
  isCompact: boolean,
): EditorViewMode {
  if (!canEdit) return 'preview'
  if (requestedMode === 'split' && isCompact) return 'edit'
  return requestedMode
}
