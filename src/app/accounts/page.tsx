import { CsvUpload } from '../../components/csv-upload.tsx'
import { getAccounts, getRecentSyncs } from '../../lib/queries.ts'
import { fullDate, money, plural } from '../../lib/format.ts'

export const dynamic = 'force-dynamic'

export default async function AccountsPage() {
  const [accounts, syncs] = await Promise.all([getAccounts(), getRecentSyncs(6)])

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
                      {new Date(run.startedAt).toLocaleString('en-NZ')}
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
