import { AddPasskey } from '../../../components/add-passkey.tsx'
import { CsvUpload } from '../../../components/csv-upload.tsx'
import { listPasskeys } from '../../../lib/auth/passkeys.ts'
import { authEnabled } from '../../../lib/auth/session.ts'
import { getAccounts, getRecentSyncs, getSettings } from '../../../lib/queries.ts'
import { dateTime, fullDate, money, plural } from '../../../lib/format.ts'
import { forgetPasskey } from '../../auth-actions.ts'
import { setStatementStartDay } from '../../actions.ts'

export const dynamic = 'force-dynamic'

const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

export default async function AccountsPage() {
  const signInOn = authEnabled()

  const [accounts, syncs, settings, passkeys] = await Promise.all([
    getAccounts(),
    getRecentSyncs(6),
    getSettings(),
    signInOn ? listPasskeys() : [],
  ])

  const startDay = settings.statementStartDay
  const endDay = startDay === 1 ? 'end of the month' : `${ordinal(startDay - 1)}`

  const synced = accounts.filter((account) => account.source === 'akahu')
  const manual = accounts.filter((account) => account.source === 'csv')

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p>
            Where the numbers come from, and whether each source is still current. An account
            that stops arriving does not fail — it just goes quiet, which is why this page exists.
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Statement period</h2>
            <p>
              Every figure in the app is grouped by this. Changing it regroups history
              immediately — nothing is stored per period, so there is nothing to rebuild.
            </p>
          </div>
        </div>

        <form action={setStatementStartDay} className="toolbar">
          <div className="field">
            <label htmlFor="statementStartDay">Starts on the</label>
            <select id="statementStartDay" name="statementStartDay" defaultValue={startDay}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {ordinal(day)}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit">
            Save period
          </button>
          <span className="note">
            {startDay === 1
              ? 'Calendar months: the 1st to the end of the month.'
              : `Runs the ${ordinal(startDay)} to the ${endDay} of the following month.`}{' '}
            Capped at the 28th, because later days do not exist in every month and would leave
            gaps.
          </span>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Signing in</h2>
            <p>
              The password in <code>APP_PASSWORD</code> is the root of trust and always works. A
              passkey is a faster way to present the same fact, and can only be added by someone
              already signed in — so every one of these descends from someone who knew the
              password. Changing the password signs every device out; it does not remove these.
            </p>
          </div>
        </div>

        {!signInOn ? (
          <div className="empty">
            <strong>Sign-in is off</strong>
            <code>APP_PASSWORD</code> is unset, so every page is open to anyone who can reach this
            URL. There is nothing for a passkey to unlock until it is set.
          </div>
        ) : (
          <>
            {passkeys.length === 0 ? (
              <p className="note">
                No passkeys yet. Adding one means the password is something you keep rather than
                something you type.
              </p>
            ) : (
              passkeys.map((passkey) => (
                <div key={passkey.credentialId} className="account-row">
                  <div className="account-name">
                    <strong>{passkey.label}</strong>
                    <small>
                      {passkey.deviceType === 'multiDevice'
                        ? passkey.backedUp
                          ? 'synced to a keychain'
                          : 'syncable, not backed up'
                        : 'this device only'}
                    </small>
                  </div>
                  <div className="account-facts">
                    <span>added {fullDate(passkey.createdAt)}</span>
                    <span>
                      {passkey.lastUsedAt ? `last used ${fullDate(passkey.lastUsedAt)}` : 'never used'}
                    </span>
                  </div>
                  <form action={forgetPasskey}>
                    <input type="hidden" name="credentialId" value={passkey.credentialId} />
                    <button type="submit" className="btn btn-quiet">
                      Forget
                    </button>
                  </form>
                </div>
              ))
            )}

            <div style={{ marginTop: 16 }}>
              <AddPasskey />
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Imported by hand</h2>
            <p>
              Akahu has no integration for the Flight Centre Mastercard, so it arrives as a
              statement export. Drop a new one in whenever you download it — importing the whole
              file again is safe, and rows already here are skipped.
            </p>
          </div>
        </div>

        {manual.map((account) => (
          <div key={account.id} className="account-row">
            <div className="account-name">
              <strong>{account.name}</strong>
              <small>{account.institution}</small>
            </div>
            <div className="account-facts">
              <span>{plural(account.transactionCount, 'transaction')}</span>
              {account.latestTransaction && (
                <span>newest {fullDate(account.latestTransaction)}</span>
              )}
            </div>
            {account.isStale ? (
              <span className="tag tag-warn">
                {account.daysSinceTransaction} days behind
              </span>
            ) : (
              <span className="tag tag-living">current</span>
            )}
          </div>
        ))}

        <div style={{ marginTop: 16 }}>
          <CsvUpload />
        </div>

        {manual.some((account) => account.isStale) && (
          <p className="note" style={{ marginTop: 12 }}>
            While this is behind, spending is understated rather than incomplete: the Kiwibank
            payment settling these purchases is excluded whether or not the purchases themselves
            have been imported.
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Synced from Akahu</h2>
            <p>
              Pulled daily. “Behind” means the sync has not reached the account, not that the
              account is quiet — a mortgage posts monthly and that is not a fault.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th style={{ width: 130 }}>Institution</th>
                <th className="col-amount" style={{ width: 130 }}>Balance</th>
                <th className="col-amount" style={{ width: 90 }}>Rows</th>
                <th style={{ width: 190 }}>History</th>
                <th style={{ width: 110 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {synced.map((account) => (
                <tr key={account.id}>
                  <td style={{ fontWeight: 500 }}>{account.name}</td>
                  <td style={{ color: 'var(--ink-muted)', fontSize: 12 }}>{account.institution}</td>
                  <td className="col-num">
                    {account.balance === null ? '—' : money(account.balance)}
                  </td>
                  <td className="col-num">{account.transactionCount}</td>
                  <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                    {account.oldestTransaction
                      ? `from ${fullDate(account.oldestTransaction)}`
                      : 'no transactions'}
                  </td>
                  <td>
                    {account.isStale ? (
                      <span className="tag tag-warn">not synced</span>
                    ) : (
                      <span className="tag tag-living">synced</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Recent syncs</h2>
            <p>
              A sync that silently stops returning transactions looks exactly like a quiet month.
              This is how you tell the difference.
            </p>
          </div>
        </div>

        {syncs.length === 0 ? (
          <div className="empty">
            <strong>No syncs recorded</strong>
            Run <code>node scripts/sync.ts</code>, or wait for the scheduled task.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 190 }}>When</th>
                  <th style={{ width: 110 }}>Trigger</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th className="col-amount" style={{ width: 110 }}>New</th>
                  <th className="col-amount" style={{ width: 140 }}>Uncategorised</th>
                </tr>
              </thead>
              <tbody>
                {syncs.map((run) => (
                  <tr key={run.startedAt}>
                    <td style={{ fontSize: 12 }}>
                      {dateTime(run.startedAt)}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{run.trigger}</td>
                    <td>
                      <span
                        className={`tag ${run.status === 'success' ? 'tag-living' : run.status === 'running' ? 'tag-ghost' : 'tag-alert'}`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="col-num">{run.transactionsNew}</td>
                    <td className="col-num">{run.uncategorised ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
