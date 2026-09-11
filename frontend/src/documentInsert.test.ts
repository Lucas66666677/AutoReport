import { describe, expect, it } from 'vitest'
import { insertOwnedDocument } from './documentInsert'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// The source-level guard -- App.tsx must never chain `.select()` onto a
// documents insert -- lives in backend/tests/test_document_insert_contract.py,
// beside the repository's other source-scanning release gates.

describe('insertOwnedDocument', () => {
  it('inserts with a generated uuid and returns that id', async () => {
    const rows: Record<string, unknown>[] = []
    const id = await insertOwnedDocument(
      async (row) => {
        rows.push(row)
        return { error: null }
      },
      { title: 'T', user_id: 'owner' },
    )

    expect(id).toMatch(UUID)
    expect(rows).toEqual([{ title: 'T', user_id: 'owner', id }])
  })

  it('never asks for the inserted row back', async () => {
    // A bare promise has no `.select`: chaining one onto the insert, which is
    // what INSERT ... RETURNING needs, would throw here.
    await expect(
      insertOwnedDocument(() => Promise.resolve({ error: null }), { title: 'T' }),
    ).resolves.toMatch(UUID)
  })

  it("surfaces the database's reason as an Error, not a plain object", async () => {
    const attempt = insertOwnedDocument(
      async () => ({ error: { message: 'new row violates row-level security policy for table "documents"' } }),
      { title: 'T' },
    )

    await expect(attempt).rejects.toBeInstanceOf(Error)
    await expect(attempt).rejects.toThrow('row-level security')
  })
})
