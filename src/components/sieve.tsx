import type { Sieve as SieveData, SieveBand } from '../lib/queries.ts'
import { money, moneyWhole } from '../lib/format.ts'

/**
 * The sieve: everything that left the account, with each band that is not
 * spending peeling off in turn, ending in the one that is.
 *
 * Excluded money is drawn hatched rather than merely a different colour. The
 * app's whole argument is the difference between money that counts and money
 * that only looks like it does, so that distinction gets a texture of its own
 * and survives being printed, screenshotted or read by someone colourblind.
 */

const EXCLUDED_KEYS = new Set(['passthrough', 'card_payment', 'internal_transfer', 'unidentified'])

function fillFor(band: SieveBand): string {
  if (band.key === 'living') return 'var(--living)'
  if (band.key === 'non_consumption') return 'var(--capital)'
  return 'repeating-linear-gradient(135deg, var(--excluded) 0 1.5px, var(--excluded-soft) 1.5px 5px)'
}

export function Sieve({ data, averageLiving }: { data: SieveData; averageLiving: number }) {
  const bands = data.bands.filter((band) => band.amount > 0.005)
  const total = bands.reduce((sum, band) => sum + band.amount, 0)
  const delta = averageLiving > 0 ? data.living / averageLiving - 1 : 0
  const over = delta > 0

  // Loan principal and investing are not living costs, but they still leave the
  // account. A "what's left" figure that ignores them would be flattering and
  // wrong, so the net position subtracts both.
  const capital = data.bands.find((band) => band.key === 'non_consumption')?.amount ?? 0
  const net = data.income + data.passthroughRetained - data.living - capital

  return (
    <div className="sieve">
      <div>
        <div className="eyebrow">{moneyWhole(total)} left my accounts this period</div>

        <div className="sieve-bar" role="img" aria-label={describe(bands, total)}>
          {bands.map((band) => (
            <div
              key={band.key}
              className="sieve-seg"
              style={{ width: `${(band.amount / total) * 100}%`, background: fillFor(band) }}
              title={`${band.label} — ${money(band.amount)}`}
            />
          ))}
        </div>

        <dl className="sieve-legend">
          {bands.map((band) => {
            const excluded = EXCLUDED_KEYS.has(band.key)
            const result = band.key === 'living'

            return (
              <div
                key={band.key}
                className={`sieve-row${excluded ? ' sieve-excluded' : ''}${result ? ' is-result' : ''}`}
              >
                <span className="sieve-swatch" style={{ background: fillFor(band) }} aria-hidden />
                <dt className="sieve-label">
                  {band.label}
                  <span className="sieve-because">{band.because}</span>
                </dt>
                <dd className="sieve-amount num">
                  {result ? '' : '− '}
                  {money(band.amount)}
                </dd>
              </div>
            )
          })}
        </dl>
      </div>

      <div>
        <div className="headline">
          <div className="eyebrow">Living costs</div>
          <div className="headline-value">{moneyWhole(data.living)}</div>
          {averageLiving > 0 && (
            <div className={`headline-delta ${over ? 'delta-over' : 'delta-under'}`}>
              {over ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(0)}% vs 12-period average
              <span className="num" style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>
                {moneyWhole(averageLiving)}
              </span>
            </div>
          )}
          <div className="headline-note">
            Includes mortgage interest. Investing, card and mortgage payments, and transfers
            between my own accounts are all excluded.
          </div>
        </div>

        <dl className="stat-list">
          <div className="stat-row">
            <dt>Income</dt>
            <dd>{moneyWhole(data.income)}</dd>
          </div>
          <div className="stat-row">
            <dt>Retained from passthrough</dt>
            <dd>{moneyWhole(data.passthroughRetained)}</dd>
          </div>
          <div className="stat-row">
            <dt>Less living costs</dt>
            <dd>−{moneyWhole(data.living)}</dd>
          </div>
          <div className="stat-row">
            <dt>Less investing and transfers</dt>
            <dd>−{moneyWhole(capital)}</dd>
          </div>
          <div className="stat-row" style={{ borderTop: '2px solid var(--ink)', paddingTop: 10 }}>
            <dt style={{ fontWeight: 600, color: 'var(--ink)' }}>Net position</dt>
            <dd style={{ fontWeight: 700, color: net >= 0 ? 'var(--living)' : 'var(--alert)' }}>
              {moneyWhole(net)}
            </dd>
          </div>
          {data.unclassified > 0 && (
            <div className="stat-row">
              <dt>Not categorised</dt>
              <dd style={{ color: 'var(--warn)' }}>{moneyWhole(data.unclassified)}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}

function describe(bands: SieveBand[], total: number): string {
  const parts = bands.map(
    (band) => `${band.label} ${money(band.amount)}, ${Math.round((band.amount / total) * 100)}%`,
  )
  return `Breakdown of ${money(total)} leaving the account: ${parts.join('; ')}.`
}
