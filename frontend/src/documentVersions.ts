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

function newVersionId(): string {
  // A uuid lets the same snapshot live in public.document_versions.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `version-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createDocumentVersion(
  document: VersionedDocument,
  content: string,
  note: string,
): DocumentVersion {
  return {
    id: newVersionId(),
    documentId: document.id,
    title: document.title,
    content,
    createdAt: new Date().toISOString(),
    note,
  }
}

export type DocumentVersionRow = {
  id: string
  document_id: string
  title: string | null
  content: string
  note: string | null
  created_at: string
}

export function versionFromRow(row: DocumentVersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title ?? '',
    content: row.content,
    createdAt: row.created_at,
    note: row.note ?? '',
  }
}

export function versionToRow(version: DocumentVersion, userId: string) {
  return {
    id: version.id,
    document_id: version.documentId,
    user_id: userId,
    title: version.title.slice(0, 500),
    content: version.content,
    note: version.note.slice(0, 200),
  }
}

export function mergeVersions(local: DocumentVersion[], cloud: DocumentVersion[]): DocumentVersion[] {
  const byId = new Map<string, DocumentVersion>()
  for (const version of [...cloud, ...local]) {
    if (!byId.has(version.id)) byId.set(version.id, version)
  }
  return [...byId.values()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}
