export type DocumentVersion = {
  id: string
  documentId: string
  title: string
  content: string
  createdAt: string
  note: string
}

type VersionedDocument = {
  id: string
  title: string
}

export function readDocumentVersions(storageKey: string): DocumentVersion[] {
  if (typeof window === 'undefined') return []

  const savedVersions = window.localStorage.getItem(storageKey)
  if (!savedVersions) return []

  try {
    const parsed = JSON.parse(savedVersions) as DocumentVersion[]
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (version) =>
        typeof version.id === 'string' &&
        typeof version.documentId === 'string' &&
        typeof version.content === 'string' &&
        typeof version.createdAt === 'string',
    )
  } catch {
    return []
  }
}

export function createDocumentVersion(
  document: VersionedDocument,
  content: string,
  note: string,
): DocumentVersion {
  return {
    id: `version-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    documentId: document.id,
    title: document.title,
    content,
    createdAt: new Date().toISOString(),
    note,
  }
}
