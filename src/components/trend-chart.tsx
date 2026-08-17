import Link from 'next/link'

import type { TrendPoint } from '../lib/queries.ts'
import { investedShare, investedShareAcross } from '../lib/dashboard.ts'
import { money, moneyWhole, periodTick } from '../lib/format.ts'

/**
 * Living costs per statement period, with loan and investing stacked above in
 * the capital colour so the two are comparable without being conflated. Above
 * each column is the share of that period's outgoing that went into the pale
 * block rather than being spent, because the height of the block answers "how
 * much" and the question underneath it is "how much of the total". The dashed
 * rule is the mean of living costs across the periods shown.
 *
 * Plain SVG: twelve columns and a line do not justify a charting library.
 */

const W = 760
const H = 210
// The right gutter exists so the average label has somewhere to sit that is not
// on top of the last column; the top one is headroom for the invested share
// above the tallest column.
const PAD = { top: 30, right: 66, bottom: 26, left: 52 }

export function TrendChart({
  points,
  selected,
  average,
  showCapital = true,
}: {
  points: TrendPoint[]
  selected?: string
  /** Passed in so the rule here and the headline delta cannot disagree. */
  average: number
  showCapital?: boolean
}) {
  if (points.length === 0) return null

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const tallest = Math.max(
    ...points.map((p) => p.living + (showCapital ? p.nonConsumption : 0)),
    1,
  )
  const ceiling = niceCeiling(tallest)

  const slot = plotW / points.length
  const barW = Math.min(38, slot * 0.62)
  const y = (value: number) => PAD.top + plotH - (value / ceiling) * plotH
  const xOf = (i: number) => PAD.left + slot * i + (slot - barW) / 2

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={
        `Living costs by statement period. Average ${money(average)}.` +
        (showCapital ? ` ${describeInvested(points)}` : '')
      }
    >
      {[0, 0.5, 1].map((fraction) => (
        <g key={fraction}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(ceiling * fraction)}
            y2={y(ceiling * fraction)}
            stroke="var(--line)"
          />
          <text className="chart-axis" x={PAD.left - 8} y={y(ceiling * fraction) + 3} textAnchor="end">
            {fraction === 0 ? '0' : compact(ceiling * fraction)}
          </text>
        </g>
      ))}

      {points.map((point, i) => {
        const x = xOf(i)
        const isSelected = point.periodStart === selected
        const capitalH = showCapital ? plotH - (y(point.nonConsumption) - PAD.top) : 0
        const livingH = plotH - (y(point.living) - PAD.top)

        const invested = investedShare(point)

        // One string, not two children: adjacent text nodes inside an SVG
        // <title> serialise differently on the server and the client, which
        // React reports as a hydration mismatch.
        const tooltip =
          `${periodTick(point.periodStart)} — living ${money(point.living)}` +
          (showCapital
            ? `, loan and investing ${money(point.nonConsumption)}` +
              (invested === null
                ? ''
                : `: ${percentWhole(invested)} of what went out, against ${percentWhole(1 - invested)} spent`)
            : '')

        return (
          <Link key={point.periodStart} href={`/?period=${point.periodStart}`}>
            <g className="chart-bar">
              <title>{tooltip}</title>

              {isSelected && (
                <rect
                  x={x - 6}
                  y={PAD.top}
                  width={barW + 12}
                  height={plotH}
                  fill="var(--surface-sunk)"
                  rx="3"
                />
              )}

              {showCapital && point.nonConsumption > 0 && (
                <rect
                  x={x}
                  y={y(point.living + point.nonConsumption)}
                  width={barW}
                  height={Math.max(0, capitalH)}
                  fill="var(--capital)"
                  opacity={isSelected ? 0.6 : 0.42}
                  rx="2"
                />
              )}

              <rect
                x={x}
                y={y(point.living)}
                width={barW}
                height={Math.max(0, livingH)}
                fill="var(--living)"
                opacity={isSelected ? 1 : 0.85}
                rx="2"
              />

              <text
                className="chart-axis"
                x={x + barW / 2}
                y={H - 9}
                textAnchor="middle"
                fontWeight={isSelected ? 600 : 400}
                fill={isSelected ? 'var(--ink)' : undefined}
              >
                {periodTick(point.periodStart)}
              </text>
            </g>
          </Link>
        )
      })}

      <line className="chart-rule" x1={PAD.left} x2={W - PAD.right} y1={y(average)} y2={y(average)} />
      <text className="chart-rule-label" x={W - PAD.right + 6} y={y(average) + 3} textAnchor="start">
        {moneyWhole(average)}
      </text>
      <text className="chart-rule-label" x={W - PAD.right + 6} y={y(average) - 8} textAnchor="start">
        average
      </text>

      {/* Last, and outside the columns, so a period that lands near the average
          keeps a readable share instead of wearing the dashed rule through it.
          Nothing here takes the pointer, so the column underneath still hovers
          and still carries the tooltip. */}
      {showCapital &&
        points.map((point, i) => {
          const invested = investedShare(point)
          if (invested === null) return null
          const isSelected = point.periodStart === selected

          return (
            <text
              key={point.periodStart}
              className="chart-share"
              x={xOf(i) + barW / 2}
              y={y(point.living + point.nonConsumption) - 7}
              textAnchor="middle"
              fontWeight={isSelected ? 600 : 400}
              // The cut-out has to match whatever it is cut out of, and the
              // selected column is standing on a darker patch than the card.
              style={isSelected ? { stroke: 'var(--surface-sunk)' } : undefined}
            >
              {percentWhole(invested)}
            </text>
          )
        })}
    </svg>
  )
}

/**
 * Rounding to a whole percent means a period with a token amount put away reads
 * as 0%, which is honest: the alternative is a label claiming a share the pale
 * block above it is too thin to show.
 */
function percentWhole(share: number): string {
  return `${Math.round(share * 100)}%`
}

/** The same reading in words, for a reader who cannot see the columns. */
function describeInvested(points: TrendPoint[]): string {
  const share = investedShareAcross(points)
  if (share === null) return ''
  return `Across the periods shown, ${percentWhole(share)} of what went out was put away rather than spent.`
}

function niceCeiling(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2)
}

function compact(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
  return String(Math.round(value))
}
