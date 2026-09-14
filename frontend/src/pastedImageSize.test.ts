import { describe, expect, it } from 'vitest'
import {
  MAX_EDGE,
  SHRINK_ABOVE_BYTES,
  isFullyOpaque,
  renameForType,
  shouldShrink,
  targetDimensions,
} from './pastedImageSize'

describe('targetDimensions', () => {
  it('leaves an image already within the limit alone', () => {
    expect(targetDimensions(1200, 800)).toEqual({ width: 1200, height: 800 })
  })

  it('scales the long edge down and keeps the aspect ratio', () => {
    expect(targetDimensions(1920, 1080)).toEqual({ width: 1600, height: 900 })
  })

  it('measures the long edge, not the width', () => {
    expect(targetDimensions(1080, 1920)).toEqual({ width: 900, height: 1600 })
  })

  it('never rounds an extreme panorama away to nothing', () => {
    expect(targetDimensions(20_000, 3).height).toBe(1)
  })
})

describe('shouldShrink', () => {
  it('shrinks an oversized screenshot', () => {
    expect(shouldShrink('image/png', 1_851_213, 1920, 1080)).toBe(true)
  })

  it('shrinks a heavy image even when its dimensions are fine', () => {
    expect(shouldShrink('image/png', SHRINK_ABOVE_BYTES + 1, 800, 600)).toBe(true)
  })

  it('leaves a small image exactly as pasted', () => {
    expect(shouldShrink('image/png', 12_000, 800, 600)).toBe(false)
  })

  // Rasterising either of these loses something the original had.
  it('never touches SVG, which has no resolution to shrink', () => {
    expect(shouldShrink('image/svg+xml', 900_000, 4000, 4000)).toBe(false)
  })

  it('never touches GIF, because re-encoding keeps one frame', () => {
    expect(shouldShrink('image/gif', 900_000, 4000, 4000)).toBe(false)
  })

  it('ignores anything that is not an image', () => {
    expect(shouldShrink('application/pdf', 900_000, 4000, 4000)).toBe(false)
  })

  // Weight decides. Re-encoding a light image costs more time than it saves, so
  // being merely large in pixels is not enough to pay for it.
  it('leaves a light image alone even at full screen resolution', () => {
    expect(shouldShrink('image/png', 197 * 1024, 1920, 1080)).toBe(false)
  })

  it('still shrinks something far past any page width, however light', () => {
    expect(shouldShrink('image/png', 1_000, MAX_EDGE * 2 + 1, 100)).toBe(true)
    expect(shouldShrink('image/png', 1_000, MAX_EDGE * 2, 100)).toBe(false)
  })
})

describe('isFullyOpaque', () => {
  const pixels = (alphas: number[]) =>
    Uint8ClampedArray.from(alphas.flatMap((alpha) => [0, 0, 0, alpha]))

  it('accepts an image with no transparency', () => {
    expect(isFullyOpaque(pixels(Array(64).fill(255)), 1)).toBe(true)
  })

  it('rejects an image with a transparent pixel', () => {
    const alphas = Array(64).fill(255)
    alphas[32] = 0
    expect(isFullyOpaque(pixels(alphas), 1)).toBe(false)
  })

  it('rejects partial transparency, not just fully clear pixels', () => {
    const alphas = Array(64).fill(255)
    alphas[16] = 128
    expect(isFullyOpaque(pixels(alphas), 1)).toBe(false)
  })
})

describe('renameForType', () => {
  it('renames a PNG to jpg when it was encoded as JPEG', () => {
    expect(renameForType('screenshot.png', 'image/jpeg')).toBe('screenshot.jpg')
  })

  it('keeps a png extension for PNG output', () => {
    expect(renameForType('screenshot.png', 'image/png')).toBe('screenshot.png')
  })

  it('adds an extension to a name that has none', () => {
    expect(renameForType('pasted-image', 'image/png')).toBe('pasted-image.png')
  })

  it('does not mistake a dot in a folder name for an extension', () => {
    expect(renameForType('my.photos/capture', 'image/png')).toBe('my.photos/capture.png')
  })
})
