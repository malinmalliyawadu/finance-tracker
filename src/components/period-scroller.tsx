'use client'

import { useEffect, useRef } from 'react'

/**
 * Scrolls the selected period chip into view.
 *
 * Thirteen chips fit across a laptop, so on one the strip is a row and the
 * current period is simply visible. On a phone about four fit, the strip opens
 * scrolled to its left-hand end, and the chips run oldest to newest — so the
 * period the page is actually showing was off the right-hand edge, on every
 * page that carries a picker. There was nothing wrong with the picker at any
 * width; there was just no reason for a phone to start reading at the far end
 * of last year.
 *
 * A client island rather than a client picker: the chips are still rendered on
 * the server and passed through as children, so this ships the scroll and
 * nothing else.
 */
export function PeriodScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const strip = ref.current
    if (!strip) return

    const active = strip.querySelector<HTMLElement>('[aria-current="true"]')
    if (!active) return

    // Centred rather than merely revealed, so the periods either side are
    // reachable without a second scroll. Written to scrollLeft rather than
    // scrollIntoView because that scrolls every ancestor that can scroll — the
    // document included, which jumped the page down to the picker on load.
    strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2
  }, [])

  return (
    <div className="periods" role="group" aria-label="Statement period" ref={ref}>
      {children}
    </div>
  )
}
