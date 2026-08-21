import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandLockup, BrandMark } from './Brand'

describe('brand components', () => {
  it('exposes a useful accessible name for a standalone mark', () => {
    render(<BrandMark size="compact" />)

    const image = screen.getByRole('img', { name: 'Lucirel Wave Gate' })
    expect(image.getAttribute('width')).toBe('36')
    expect(image.getAttribute('height')).toBe('36')
  })

  it('uses real product text and hides the repeated mark from assistive technology', () => {
    const { container } = render(<BrandLockup surface="dark" />)

    expect(screen.getByText('AutoLabReport')).toBeTruthy()
    expect(screen.getByText('by Lucirel')).toBeTruthy()
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(container.querySelector('img')?.getAttribute('aria-hidden')).toBe('true')
  })
})
