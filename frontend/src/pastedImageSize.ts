// A pasted screenshot arrives at full resolution and losslessly compressed. Measured
// in the running editor on 2026-09-14 with a 1920x1080 capture: 1.85 MB of PNG, which
// as a base64 data URL becomes 2,468,323 characters of Markdown. Inserting it took
// 484 ms and the page then spent a further 5.2 seconds in long tasks -- Monaco
// tokenising that one enormous line, the preview re-rendering it, the autosave
// serialising it. A signed-in user pays the same weight as upload time instead, and
// again on every export.
//
// A figure in a lab report does not need more than about 1600px on its long edge, so
// anything past that is shrunk and re-encoded.
//
// Deliberately NOT WebP: these images end up in the .docx export, and Word's support
// for WebP is too recent to rely on. PNG and JPEG are safe everywhere.

export const MAX_EDGE = 1600

// Below this a re-encode is not worth the quality risk -- the weight is already fine.
export const SHRINK_ABOVE_BYTES = 256 * 1024

export const JPEG_QUALITY = 0.85

// Rasterising these would be a downgrade, not a saving: SVG is resolution-free, and
// re-encoding an animated GIF keeps one frame.
const KEEP_AS_IS = /^image\/(svg\+xml|gif)$/i

/** The size to draw at: unchanged when the image is already within MAX_EDGE. */
export function targetDimensions(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }

  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Whether this file is worth touching at all.
 *
 * Weight is the thing that hurts, not pixel count. A 1920x1080 capture of a mostly
 * flat interface came to 197 KB and re-encoding it cost 1.1 s to save 130 KB of
 * base64 -- a bad trade on the paste path. So bytes decide, and dimensions only
 * force the issue when an image is far past anything a report page can show.
 */
export function shouldShrink(
  type: string,
  bytes: number,
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): boolean {
  if (!type.startsWith('image/') || KEEP_AS_IS.test(type)) return false
  if (bytes > SHRINK_ABOVE_BYTES) return true
  return Math.max(width, height) > maxEdge * 2
}

/** Swap the extension so the name still matches the bytes. */
export function renameForType(name: string, type: string): string {
  const extension = type === 'image/jpeg' ? 'jpg' : 'png'
  const stem = name.replace(/\.[^./\\]*$/, '') || 'pasted-image'
  return `${stem}.${extension}`
}

/**
 * True when every sampled pixel is fully opaque, so JPEG is safe to use.
 */
export function isFullyOpaque(data: Uint8ClampedArray, step = 1): boolean {
  for (let index = 3; index < data.length; index += 4 * step) {
    if (data[index] !== 255) return false
  }
  return true
}

/** The size of the throwaway canvas the alpha probe draws onto. */
export const ALPHA_PROBE_EDGE = 256

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Whether the image carries no transparency at all.
 *
 * A JPEG never does, by format, so that answer is free. For anything else the check
 * runs on a small nearest-neighbour copy rather than the full image: reading back
 * 1600x900 allocates ~5.8 MB on the paste path for a yes/no answer. Smoothing is off
 * deliberately -- interpolation would average a transparent pixel into an almost
 * opaque one and hide it.
 */
function hasNoTransparency(sourceType: string, bitmap: ImageBitmap): boolean {
  if (sourceType === 'image/jpeg') return true

  const probe = document.createElement('canvas')
  const { width, height } = targetDimensions(bitmap.width, bitmap.height, ALPHA_PROBE_EDGE)
  probe.width = width
  probe.height = height

  const context = probe.getContext('2d', { willReadFrequently: true })
  // Unknown beats a wrong guess: PNG keeps whatever transparency is there.
  if (!context) return false

  context.imageSmoothingEnabled = false
  context.drawImage(bitmap, 0, 0, width, height)
  return isFullyOpaque(context.getImageData(0, 0, width, height).data)
}

/**
 * Shrink a pasted image, or return it untouched. Never returns something larger than
 * it was given, and never rejects: a paste that cannot be shrunk still has to paste.
 */
export async function shrinkPastedImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  if (!file.type.startsWith('image/') || KEEP_AS_IS.test(file.type)) return file

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    if (!shouldShrink(file.type, file.size, bitmap.width, bitmap.height)) return file

    const { width, height } = targetDimensions(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)

    // JPEG cannot carry transparency, so it is only used when there is none to lose.
    // Encoding BOTH and keeping the smaller cost more than it saved: measured at
    // 1.8 s for one screenshot, most of it in the second encode and in reading back
    // 1.4 million pixels to check the alpha. One encode, and a cheap probe.
    const opaque = hasNoTransparency(file.type, bitmap)
    const encoded = opaque
      ? await encode(canvas, 'image/jpeg', JPEG_QUALITY)
      : await encode(canvas, 'image/png')

    // Re-encoding can grow an image that was already compressed well.
    if (!encoded || encoded.size >= file.size) return file

    return new File([encoded], renameForType(file.name, encoded.type), { type: encoded.type })
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}
