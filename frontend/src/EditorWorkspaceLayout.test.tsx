import { useEffect, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorWorkspaceLayout from './EditorWorkspaceLayout'
import type { EditorViewMode } from './editorViewMode'

afterEach(cleanup)

function WorkspaceHarness({
  mode,
  canEdit = true,
  onCommit = () => undefined,
  editor = <textarea defaultValue="內容保持不變" />,
}: {
  mode: EditorViewMode
  canEdit?: boolean
  onCommit?: (ratio: number) => void
  editor?: React.ReactNode
}) {
  const [ratio, setRatio] = useState(50)

  return (
    <EditorWorkspaceLayout
      mode={mode}
      canEdit={canEdit}
      splitRatio={ratio}
      onSplitRatioChange={setRatio}
      onSplitRatioCommit={onCommit}
      editor={editor}
      preview={<article>預覽內容</article>}
    />
  )
}

function setWorkspaceWidth(width: number) {
  const workspace = screen.getByTestId('editor-workspace')
  Object.defineProperty(workspace, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width, left: 0, right: width, top: 0, bottom: 700, height: 700, x: 0, y: 0, toJSON: () => ({}) }),
  })
  fireEvent(window, new Event('resize'))
}

describe('EditorWorkspaceLayout', () => {
  it('shows the correct panes for Edit, Split, and Preview', () => {
    const view = render(<WorkspaceHarness mode="split" />)
    expect(screen.getByTestId('editor-pane').hidden).toBe(false)
    expect(screen.getByTestId('preview-pane').hidden).toBe(false)
    expect(screen.getByRole('separator')).not.toBeNull()

    view.rerender(<WorkspaceHarness mode="edit" />)
    expect(screen.getByTestId('editor-pane').hidden).toBe(false)
    expect(screen.getByTestId('preview-pane').hidden).toBe(true)

    view.rerender(<WorkspaceHarness mode="preview" />)
    expect(screen.getByTestId('editor-pane').hidden).toBe(true)
    expect(screen.getByTestId('preview-pane').hidden).toBe(false)
  })

  it('prevents view-only users from exposing the editor', () => {
    render(<WorkspaceHarness mode="edit" canEdit={false} />)
    expect(screen.getByTestId('editor-pane').hidden).toBe(true)
    expect(screen.getByTestId('preview-pane').hidden).toBe(false)
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('drags, clamps, and commits the split ratio only when dragging ends', () => {
    const onCommit = vi.fn()
    render(<WorkspaceHarness mode="split" onCommit={onCommit} />)
    setWorkspaceWidth(1000)
    const separator = screen.getByRole('separator')

    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 1200 })
    expect(separator.getAttribute('aria-valuenow')).toBe('67')
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 1200 })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0]).toBeCloseTo(67.4)
  })

  it('supports keyboard resizing and commits the adjusted value', () => {
    const onCommit = vi.fn()
    render(<WorkspaceHarness mode="split" onCommit={onCommit} />)
    setWorkspaceWidth(1000)
    const separator = screen.getByRole('separator')

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator.getAttribute('aria-valuenow')).toBe('52')
    expect(onCommit).toHaveBeenCalledWith(52)
  })

  it('uses a single pane when narrow and restores Split when width returns', () => {
    render(<WorkspaceHarness mode="split" />)
    setWorkspaceWidth(500)
    expect(screen.getByTestId('editor-workspace').getAttribute('data-effective-mode')).toBe('edit')
    expect(screen.queryByRole('separator')).toBeNull()

    setWorkspaceWidth(1000)
    expect(screen.getByTestId('editor-workspace').getAttribute('data-effective-mode')).toBe('split')
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('50')
  })

  it('keeps the editor mounted across mode changes', () => {
    let mountCount = 0
    function PersistentEditor() {
      useEffect(() => {
        mountCount += 1
      }, [])
      return <textarea defaultValue="游標與內容由同一個實例持有" />
    }

    const view = render(<WorkspaceHarness mode="split" editor={<PersistentEditor />} />)
    const editor = screen.getByDisplayValue('游標與內容由同一個實例持有')
    fireEvent.change(editor, { target: { value: '切換後仍保留' } })
    view.rerender(<WorkspaceHarness mode="preview" editor={<PersistentEditor />} />)
    view.rerender(<WorkspaceHarness mode="edit" editor={<PersistentEditor />} />)

    expect(mountCount).toBe(1)
    expect(screen.getByDisplayValue('切換後仍保留')).not.toBeNull()
  })
})
