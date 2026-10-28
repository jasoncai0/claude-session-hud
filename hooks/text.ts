const ELLIPSIS = '…'

/** Wide (CJK, full-width, emoji) code points take two cells. */
const isWide = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1faff) ||
  (cp >= 0x20000 && cp <= 0x3fffd)

const cellsOf = (ch: string) => (isWide(ch.codePointAt(0) ?? 0) ? 2 : 1)

/** Terminal cells a string takes. */
export const displayWidth = (s: string): number => [...s].reduce((sum, ch) => sum + cellsOf(ch), 0)

/** The longest head of `chars` that fits in `width` cells. */
function take(chars: readonly string[], width: number): string[] {
  const out: string[] = []
  let used = 0
  for (const ch of chars) {
    const w = cellsOf(ch)
    if (used + w > width) break
    out.push(ch)
    used += w
  }
  return out
}

export type FitMode = 'end' | 'middle' | 'name'

/**
 * `s` cut to `width` cells with an ellipsis at the end, or in the middle to keep both ends; `name` drops a path to its
 * last segment (`group/service` → `service`), cut at the end if that still does not fit.
 */
export function fit(s: string, width: number, mode: FitMode = 'end'): string {
  if (displayWidth(s) <= width) return s
  if (mode === 'name') return fit(s.slice(s.lastIndexOf('/') + 1), width)
  if (width <= 1) return width === 1 ? ELLIPSIS : ''
  const chars = [...s]
  if (mode === 'end') return take(chars, width - 1).join('') + ELLIPSIS
  const room = width - 1
  const head = take(chars, Math.ceil(room / 2))
  const tail = take([...chars].reverse(), room - displayWidth(head.join(''))).reverse()
  return head.join('') + ELLIPSIS + tail.join('')
}
