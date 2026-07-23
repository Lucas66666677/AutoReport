import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  adjustSplitRatioWithKeyboard,
  getEffectiveEditorViewMode,
  getSplitRatioFromPointer,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  shouldCollapseSplit,
  type EditorViewMode,
} from './editorViewMode'

type EditorWorkspaceLayoutProps = {
  mode: EditorViewMode
  canEdit: boolean
  splitRatio: number
  onSplitRatioChange: (ratio: number) => void
  onSplitRatioCommit: (ratio: number) => void
  onCompactChange?: (isCompact: boolean) => void
  editor: ReactNode
  preview: ReactNode
}

type SplitStyle = CSSProperties & {
  '--editor-split-ratio': string
}

export default function EditorWorkspaceLayout({
  mode,
  canEdit,
  splitRatio,
  onSplitRatioChange,
  onSplitRatioCommit,
  onCompactChange,
  editor,
  preview,
}: EditorWorkspaceLayoutProps) {
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const dividerRef = useRef<HTMLDivElement | null>(null)
  const liveSplitRatioRef = useRef(splitRatio)
  const isDraggingRef = useRef(false)
  const [containerWidth, setContainerWidth] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    liveSplitRatioRef.current = splitRatio
  }, [splitRatio])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return

    function updateWidth() {
      const nextWidth = workspace?.getBoundingClientRect().width ?? 0
      setContainerWidth(nextWidth)
      onCompactChange?.(shouldCollapseSplit(nextWidth))
    }

    updateWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [onCompactChange])

  const isCompact = shouldCollapseSplit(containerWidth)
  const effectiveMode = getEffectiveEditorViewMode(mode, canEdit, isCompact)
  const splitStyle = useMemo<SplitStyle>(
    () => ({ '--editor-split-ratio': `${splitRatio}%` }),
    [splitRatio],
  )

  const updateRatioFromClientX = useCallback((clientX: number) => {
    if (!isDraggingRef.current || !workspaceRef.current) return
    const bounds = workspaceRef.current.getBoundingClientRect()
    const nextRatio = getSplitRatioFromPointer(clientX, bounds.left, bounds.width)
    liveSplitRatioRef.current = nextRatio
    onSplitRatioChange(nextRatio)
  }, [onSplitRatioChange])

  useEffect(() => {
    if (!isDragging) return
    document.documentElement.classList.add('is-resizing-editor')

    function handlePointerMove(event: globalThis.PointerEvent) {
      updateRatioFromClientX(event.clientX)
      event.preventDefault()
    }

    function handlePointerEnd(event: globalThis.PointerEvent) {
      if (!isDraggingRef.current) return
      if (dividerRef.current?.hasPointerCapture?.(event.pointerId)) {
        dividerRef.current.releasePointerCapture(event.pointerId)
      }
      isDraggingRef.current = false
      setIsDragging(false)
      onSplitRatioCommit(liveSplitRatioRef.current)
      event.preventDefault()
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerEnd, { passive: false })
    window.addEventListener('pointercancel', handlePointerEnd, { passive: false })
    return () => {
      document.documentElement.classList.remove('is-resizing-editor')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }
  }, [isDragging, onSplitRatioCommit, updateRatioFromClientX])

  function handleDividerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const nextRatio = adjustSplitRatioWithKeyboard(
      splitRatio,
      event.key,
      containerWidth,
      event.shiftKey ? 5 : 2,
    )
    liveSplitRatioRef.current = nextRatio
    onSplitRatioChange(nextRatio)
    onSplitRatioCommit(nextRatio)
    event.preventDefault()
  }

  return (
    <main
      ref={workspaceRef}
      className={`editor-workspace editor-workspace--${effectiveMode}`}
      style={splitStyle}
      data-testid="editor-workspace"
      data-requested-mode={mode}
      data-effective-mode={effectiveMode}
      data-compact={isCompact ? 'true' : 'false'}
    >
      <section
        className="editor-workspace__panel editor-workspace__editor"
        data-testid="editor-pane"
        aria-label="Markdown 編輯器"
        hidden={effectiveMode === 'preview'}
      >
        {editor}
      </section>

      {effectiveMode === 'split' && (
        <div
          ref={dividerRef}
          className={`editor-workspace__divider ${isDragging ? 'is-dragging' : ''}`}
          data-testid="split-divider"
          role="separator"
          aria-label="調整編輯器與預覽寬度"
          aria-orientation="vertical"
          aria-valuemin={MIN_SPLIT_RATIO}
          aria-valuemax={MAX_SPLIT_RATIO}
          aria-valuenow={Math.round(splitRatio)}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            liveSplitRatioRef.current = splitRatio
            isDraggingRef.current = true
            setIsDragging(true)
            event.currentTarget.setPointerCapture?.(event.pointerId)
            event.preventDefault()
          }}
          onKeyDown={handleDividerKeyDown}
          title="拖曳调整宽度；方向键微调"
        >
          <span aria-hidden="true" />
        </div>
      )}

      <section
        className="editor-workspace__panel editor-workspace__preview"
        data-testid="preview-pane"
        aria-label="Markdown 預覽"
        hidden={effectiveMode === 'edit'}
      >
        {preview}
      </section>
    </main>
  )
}
