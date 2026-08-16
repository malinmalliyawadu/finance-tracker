import Link from 'next/link'

import type { Insight } from '../lib/dashboard.ts'

/**
 * The commentary: a short ranked list of what is worth saying about the period.
 *
 * Every line carries the arithmetic behind its claim, and every line that can
 * be acted on is a link to the thing it is about. A dot in the tone colour
 * rather than a coloured panel per row — four alarming panels in a column read
 * as an emergency regardless of what they say.
 */
export function Commentary({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null

  return (
    <ul className="insights">
      {insights.map((insight) => {
        const text = (
          <span className="insight-text">
            <span className="insight-headline">{insight.headline}</span>
            <span className="insight-detail">{insight.detail}</span>
          </span>
        )

        return (
          <li key={insight.key} className={`insight insight-${insight.tone}`}>
            {insight.href ? (
              <Link href={insight.href} className="insight-body">
                {text}
              </Link>
            ) : (
              <div className="insight-body">{text}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
