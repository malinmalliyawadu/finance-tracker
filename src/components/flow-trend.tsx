import Link from 'next/link'

import type { TrendPoint } from '../lib/queries.ts'
import { money, periodTick } from '../lib/format.ts'

/**
 * Every period as what went out against what came in.
 *
 * The column is money leaving: living costs, with what was put away stacked
 * above it in the capital colour so the two are comparable without being
 * conflated. The blue line across each column is what was earned that period.
 *
 * That line is the whole point of the chart. A column of outgoings on its own
 * can only be compared with other columns; drawn under what came in, it answers
 * the question a month is actually judged by - did I live inside what I earned
 * - for every period at once, without a single number being read.
 *
 * Plain SVG: thirteen columns and a line do not justify a charting library.
 */

const W = 780
const H = 220
const PAD = { top: 18, right: 14, bottom: 28, left: 52 }

export function FlowTrend({
  points,
  selected,
  /** The period still running, drawn faint because its figures are not final. */
  partialPeriod,
}: {
  points: TrendPoint[]
  selected?: string
  partialPeriod?: string
}) {
  if (points.length === 0) return null

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const ceiling = niceCeiling(
    Math.max(...points.map((p) => Math.max(p.living + p.nonConsumption, p.income)), 1),
  )

  const slot = plotW / points.length
  const barW = Math.min(34, slot * 0.56)
  const y = (value: number) => PAD.top + plotH - (value / ceiling) * plotH
  const xOf = (index: number) => PAD.left + slot * index + (slot - barW) / 2

  const spent = points.reduce((sum, p) => sum + p.living + p.nonConsumption, 0)
  const earned = points.reduce((sum, p) => sum + p.income, 0)

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`What went out against what came in, by period. Across the ${points.length} periods shown, ${money(earned)} came in and ${money(spent)} went out.`}
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
          <text
            className="chart-axis"
            x={PAD.left - 8}
            y={y(ceiling * fraction) + 3}
            textAnchor="end"
          >
            {fraction === 0 ? '0' : compact(ceiling * fraction)}
          </text>
        </g>
      ))}

      {points.map((point, index) => {
        const x = xOf(index)
        const isSelected = point.periodStart === selected
        const isPartial = point.periodStart === partialPeriod
        const dim = isPartial ? 0.55 : isSelected ? 1 : 0.82

        // One string, not two children: adjacent text nodes inside an SVG
        // <title> serialise differently on the server and the client, which
        // React reports as a hydration mismatch.
        const tooltip =
          `${periodTick(point.periodStart)} - earned ${money(point.income)}, ` +
          `spent ${money(point.living)}, put away ${money(point.nonConsumption)}` +
          (isPartial ? ' so far' : '')

        return (
          <Link key={point.periodStart} href={`/?period=${point.periodStart}`}>
            <g className="chart-bar">
              <title>{tooltip}</title>

              {isSelected && (
                <rect
                  x={x - 7}
                  y={PAD.top}
                  width={barW + 14}
                  height={plotH}
                  fill="var(--line)"
                  opacity="0.4"
                  rx="3"
                />
              )}

              {point.nonConsumption > 0 && (
                <rect
                  x={x}
                  y={y(point.living + point.nonConsumption)}
                  width={barW}
                  height={Math.max(0, y(point.living) - y(point.living + point.nonConsumption))}
                  fill="var(--capital)"
                  opacity={dim * 0.55}
                  rx="2"
                />
              )}

              <rect
                x={x}
                y={y(point.living)}
                width={barW}
                height={Math.max(0, plotH + PAD.top - y(point.living))}
                fill="var(--living)"
                opacity={dim}
                rx="2"
              />

              {point.income > 0 && (
                <line
                  x1={x - 5}
                  x2={x + barW + 5}
                  y1={y(point.income)}
                  y2={y(point.income)}
                  stroke="var(--income)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  opacity={isPartial ? 0.5 : 1}
                />
              )}

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
    </svg>
  )
}

function niceCeiling(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2)
}

function compact(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
  return String(Math.round(value))
}
