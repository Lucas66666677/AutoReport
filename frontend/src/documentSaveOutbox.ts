export const DOCUMENT_SAVE_OUTBOX_STORAGE_KEY = 'autoLabReport_documentSaveOutbox'

export type PendingDocumentSave = {
  documentId: string
  content: string
  revision: number
  queuedAt: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function getOutboxKey(ownerKey: string): string {
  return `${DOCUMENT_SAVE_OUTBOX_STORAGE_KEY}:${ownerKey}`
}

export function readDocumentSaveOutbox(
  storage: StorageLike | null,
  ownerKey: string,
): PendingDocumentSave[] {
  if (!storage) return []
  const raw = storage.getItem(getOutboxKey(ownerKey))
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PendingDocumentSave => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<PendingDocumentSave>
      return (
        typeof candidate.documentId === 'string' &&
        typeof candidate.content === 'string' &&
        typeof candidate.revision === 'number' &&
        typeof candidate.queuedAt === 'string'
      )
    })
  } catch {
    return []
  }
}

export function queueDocumentSave(
  storage: StorageLike | null,
  ownerKey: string,
  pending: PendingDocumentSave,
): void {
  if (!storage) return
  const next = readDocumentSaveOutbox(storage, ownerKey).filter(
    (item) => item.documentId !== pending.documentId,
  )
  next.push(pending)
  storage.setItem(getOutboxKey(ownerKey), JSON.stringify(next))
}

export function removeDocumentSave(
  storage: StorageLike | null,
  ownerKey: string,
  documentId: string,
  revision: number,
): void {
  if (!storage) return
  const current = readDocumentSaveOutbox(storage, ownerKey)
  const next = current.filter(
    (item) => item.documentId !== documentId || item.revision !== revision,
  )
  storage.setItem(getOutboxKey(ownerKey), JSON.stringify(next))
}

export function removeDocumentSaves(
  storage: StorageLike | null,
  ownerKey: string,
  documentIds: ReadonlySet<string>,
): void {
  if (!storage || documentIds.size === 0) return
  const next = readDocumentSaveOutbox(storage, ownerKey).filter(
    (item) => !documentIds.has(item.documentId),
  )
  storage.setItem(getOutboxKey(ownerKey), JSON.stringify(next))
}
