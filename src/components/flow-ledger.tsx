import type { Flow } from '../lib/dashboard.ts'
import { moneyWhole } from '../lib/format.ts'

const ARROW: Record<'above' | 'below' | 'level', string> = {
  above: '▲',
  below: '▼',
  level: '–',
}

/**
 * What came in, what was spent, and what was put away, side by side.
 *
 * One movement of money rather than three statistics, so they are read as a
 * row and not as tiles: same size, same weight, distinguished only by the
 * colour the rest of the app already uses for each kind of money.
 *
 * Only spending is ever flagged. A quiet fortnight for income on day ten is not
 * bad news, it is a fortnight before payday, and a page that paints it red
 * teaches its reader to ignore red.
 */
export function FlowLedger({ flows }: { flows: Flow[] }) {
  return (
    <dl className="flows">
      {flows.map((flow) => (
        <div key={flow.key} className={`flow flow-${flow.tone}`}>
          <dt className="eyebrow">{flow.label}</dt>
          <dd>
            <span className="flow-value num">{moneyWhole(flow.value)}</span>
            <span className="flow-note">{flow.note}</span>
            {flow.delta && (
              <span
                className={`flow-delta flow-delta-${flow.delta.direction}${
                  flow.delta.alarming ? ' is-alarming' : ''
                }`}
              >
                <span aria-hidden>{ARROW[flow.delta.direction]}</span> {flow.delta.text}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
