'use server'

import { revalidatePath } from 'next/cache'

import { db } from '../lib/db.ts'
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

/** The large-purchase threshold. What counts as a decision rather than a habit. */
export async function setThreshold(formData: FormData): Promise<void> {
  const value = Number(formData.get('threshold'))
  if (!Number.isFinite(value) || value <= 0) return

  await db`update settings set large_purchase_threshold = ${value} where id`
  revalidatePath('/', 'layout')
}
