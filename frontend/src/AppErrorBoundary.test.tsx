import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppErrorBoundary from './AppErrorBoundary'

function BrokenView(): never {
  throw new Error('render failed')
}

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a recoverable fallback when the application render fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary>
        <BrokenView />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert').textContent).toContain('畫面載入失敗')
    expect(screen.getByRole('button', { name: '重新載入' })).toBeTruthy()
  })
})

