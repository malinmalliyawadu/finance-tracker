'use server'

import { revalidatePath } from 'next/cache'

import { db, syncDb } from '../lib/db.ts'
import { importGemStatement } from '../lib/import-gem.ts'
import { recompute } from '../lib/recompute.ts'
import type { ExclusionReason } from '../lib/rules-file.ts'

const EXCLUSION_REASONS: ExclusionReason[] = [
  'internal_transfer',
  'card_payment',
  'passthrough',
  'unidentified',
]

/**
 * Writes a manual verdict for one transaction.
 *
 * Only the overrides table is touched. The derived layer is left alone, because
 * the `transactions` view resolves overrides at read time — so the change shows
 * up immediately and the next recompute cannot undo it.
 */
export async function recategorise(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const verdict = String(formData.get('verdict') ?? '')
  if (!id) return

  if (verdict === 'rules') {
    await db`delete from overrides where transaction_id = ${id}`
  } else if (verdict === 'include') {
    await db`
      insert into overrides (transaction_id, force_included, category_id, exclusion_reason)
      values (${id}, true, null, null)
      on conflict (transaction_id) do update set
        force_included = true, category_id = null, exclusion_reason = null
    `
  } else if (verdict.startsWith('exclude:')) {
    const reason = verdict.slice('exclude:'.length) as ExclusionReason
    if (!EXCLUSION_REASONS.includes(reason)) return
    await db`
      insert into overrides (transaction_id, exclusion_reason, category_id, force_included)
      values (${id}, ${reason}, null, false)
      on conflict (transaction_id) do update set
        exclusion_reason = ${reason}, category_id = null, force_included = false
    `
  } else if (verdict.startsWith('cat:')) {
    const categoryId = verdict.slice('cat:'.length)
    await db`
      insert into overrides (transaction_id, category_id, exclusion_reason, force_included)
      values (${id}, ${categoryId}, null, false)
      on conflict (transaction_id) do update set
        category_id = ${categoryId}, exclusion_reason = null, force_included = false
    `
  } else {
    return
  }

  revalidatePath('/', 'layout')
}

export type ImportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'done'
      filename: string
      rowsInFile: number
      inserted: number
      alreadyPresent: number
      from: string
      to: string
      coverage: number
      unmatched: number
    }

/**
 * Imports an uploaded Latitude/Gem statement.
 *
 * Safe to run on the whole file every time: rows are keyed on a hash of the
 * original CSV line, so overlapping exports insert nothing. That matters
 * because the statement cannot be asked for "everything since last time" —
 * every export overlaps the previous one.
 */
export async function importStatement(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Choose a CSV file to import.' }
  }
  if (file.size > 8_000_000) {
    return { status: 'error', message: 'That file is over 8MB, which is far larger than a statement export. Check it is the right file.' }
  }

  try {
    const text = await file.text()
    // Writes the ledger, so it uses the sync connection rather than the
    // read-mostly one the pages render through.
    const result = await importGemStatement(syncDb, { text, filename: file.name })

    // Imported rows arrive unclassified, and an unclassified transaction is
    // missing from every total on the dashboard.
    const classified = await recompute(syncDb)

    revalidatePath('/', 'layout')

    return {
      status: 'done',
      filename: file.name,
      rowsInFile: result.rowsInFile,
      inserted: result.inserted,
      alreadyPresent: result.alreadyPresent,
      from: result.from,
      to: result.to,
      coverage: classified.coverage,
      unmatched: classified.unmatched,
    }
  } catch (error) {
    // Parse errors name the line, which is the only useful thing to say about a
    // file in the wrong format.
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Which day of the month a statement period opens on.
 *
 * Capped at 28 by the database, because 29 to 31 do not exist in every month
 * and any of them would produce periods that skip or double up.
 */
export async function setStatementStartDay(formData: FormData): Promise<void> {
  const day = Number(formData.get('statementStartDay'))
  if (!Number.isInteger(day) || day < 1 || day > 28) return

  await db`update settings set statement_start_day = ${day} where id`
  revalidatePath('/', 'layout')
}

/** The large-purchase threshold. What counts as a decision rather than a habit. */
export async function setThreshold(formData: FormData): Promise<void> {
  const value = Number(formData.get('threshold'))
  if (!Number.isFinite(value) || value <= 0) return

  await db`update settings set large_purchase_threshold = ${value} where id`
  revalidatePath('/', 'layout')
}
