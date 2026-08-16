import type { Tile } from '../lib/dashboard.ts'
import { moneyWhole } from '../lib/format.ts'

/**
 * The three figures the dashboard opens with.
 *
 * Deliberately dumb: which numbers appear, and what each is measured against,
 * is decided in lib/dashboard.ts where it can be tested. This only draws them.
 */
export function HeadlineTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="tiles">
      {tiles.map((tile) => (
        <div key={tile.key} className={`tile tile-${tile.tone}`}>
          <div className="eyebrow">{tile.label}</div>
          <div className="tile-value num">{moneyWhole(tile.value)}</div>
          <div className="tile-note">{tile.note}</div>
          {tile.delta && (
            <div className={`headline-delta ${tile.delta.over ? 'delta-over' : 'delta-under'}`}>
              {tile.delta.over ? '▲' : '▼'} {tile.delta.text}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
