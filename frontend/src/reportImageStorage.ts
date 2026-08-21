export const REPORT_IMAGE_BUCKET = 'report_images'
export const PRIVATE_REPORT_IMAGE_SCHEME = 'supabase-image://'

export function createPrivateReportImageUrl(path: string): string {
  return `${PRIVATE_REPORT_IMAGE_SCHEME}${encodeURIComponent(path)}`
}

export function parsePrivateReportImagePath(value: string | undefined): string | null {
  if (!value?.startsWith(PRIVATE_REPORT_IMAGE_SCHEME)) return null
  const encodedPath = value.slice(PRIVATE_REPORT_IMAGE_SCHEME.length)
  if (!encodedPath) return null
  try {
    const path = decodeURIComponent(encodedPath)
    return path && !path.startsWith('/') && !path.includes('..') ? path : null
  } catch {
    return null
  }
}

export function parseLegacyPublicReportImagePath(
  value: string | undefined,
  supabaseUrl: string | undefined,
): string | null {
  if (!value || !supabaseUrl) return null
  const prefix = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${REPORT_IMAGE_BUCKET}/`
  if (!value.startsWith(prefix)) return null
  try {
    const path = decodeURIComponent(value.slice(prefix.length))
    return path && !path.startsWith('/') && !path.includes('..') ? path : null
  } catch {
    return null
  }
}
