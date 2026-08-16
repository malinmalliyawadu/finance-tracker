// Server-only. The passkeys table, and nothing else. Kept out of queries.ts
// because that file is the app's read layer and this one writes credentials.
import { db } from '../db.ts'

export type Passkey = {
  credentialId: string
  publicKey: Uint8Array
  counter: number
  transports: string[]
  label: string
  deviceType: string
  backedUp: boolean
  createdAt: Date
  lastUsedAt: Date | null
}

type Row = {
  credential_id: string
  public_key: Uint8Array
  counter: string
  transports: string[]
  label: string
  device_type: string
  backed_up: boolean
  created_at: Date
  last_used_at: Date | null
}

const toPasskey = (row: Row): Passkey => ({
  credentialId: row.credential_id,
  publicKey: row.public_key,
  counter: Number(row.counter),
  transports: row.transports,
  label: row.label,
  deviceType: row.device_type,
  backedUp: row.backed_up,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
})

/** Newest first, which is the order someone adding a device wants to see. */
export async function listPasskeys(): Promise<Passkey[]> {
  const rows = await db<Row[]>`
    select credential_id, public_key, counter, transports, label, device_type,
           backed_up, created_at, last_used_at
    from passkeys
    order by created_at desc
  `
  return rows.map(toPasskey)
}

/** How many are registered. The login page asks; it has no business reading the rows. */
export async function countPasskeys(): Promise<number> {
  const [row] = await db<{ count: string }[]>`select count(*) as count from passkeys`
  return Number(row?.count ?? 0)
}

/**
 * The credential an assertion names.
 *
 * Sign-in generates options with an empty allowCredentials so the browser
 * offers whatever it holds, which means the response is the first thing that
 * says which key answered. This is that lookup.
 */
export async function findPasskey(credentialId: string): Promise<Passkey | null> {
  const [row] = await db<Row[]>`
    select credential_id, public_key, counter, transports, label, device_type,
           backed_up, created_at, last_used_at
    from passkeys
    where credential_id = ${credentialId}
  `
  return row ? toPasskey(row) : null
}

export async function savePasskey(passkey: {
  credentialId: string
  publicKey: Uint8Array
  counter: number
  transports: string[]
  label: string
  deviceType: string
  backedUp: boolean
}): Promise<void> {
  await db`
    insert into passkeys (
      credential_id, public_key, counter, transports, label, device_type, backed_up
    ) values (
      ${passkey.credentialId}, ${Buffer.from(passkey.publicKey)}, ${passkey.counter},
      ${passkey.transports}, ${passkey.label}, ${passkey.deviceType}, ${passkey.backedUp}
    )
    on conflict (credential_id) do update set
      public_key = excluded.public_key,
      counter = excluded.counter,
      transports = excluded.transports,
      label = excluded.label,
      device_type = excluded.device_type,
      backed_up = excluded.backed_up
  `
}

/**
 * The counter the authenticator reported, kept so the next assertion can be
 * compared against it. Without this write the clone check has nothing to
 * detect: every assertion would be measured against zero and pass.
 */
export async function recordUse(credentialId: string, counter: number, backedUp: boolean): Promise<void> {
  await db`
    update passkeys
    set counter = ${counter}, backed_up = ${backedUp}, last_used_at = now()
    where credential_id = ${credentialId}
  `
}

export async function deletePasskey(credentialId: string): Promise<void> {
  await db`delete from passkeys where credential_id = ${credentialId}`
}
