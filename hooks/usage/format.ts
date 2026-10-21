import type { Usage } from '../../types'

export type Level = 'success' | 'warning' | 'error'

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '额度' }
const BAR_CELLS = 6
const WARN_AT = 70
const DANGER_AT = 90
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// Desktop folds newlines into spaces and wraps the hover at a fixed width, so each window's segment is
// glued with no-break spaces: the hover can only wrap between windows, one per line.
const NBSP = ' '

export const levelOf = (pct: number): Level => (pct >= DANGER_AT ? 'error' : pct >= WARN_AT ? 'warning' : 'success')

export const bar = (pct: number, cells = BAR_CELLS): string => {
  const filled = Math.min(cells, Math.max(0, Math.round((pct / 100) * cells)))
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

// A window whose reset time has passed is a stale reading (session idle since then): drop it.
export const isFresh = (resetsAt: string | undefined, now: number): boolean => {
  if (!resetsAt) return true
  const t = Date.parse(resetsAt)
  return Number.isNaN(t) || t > now
}

export const shortCountdown = (resetsAt: string | undefined, now: number): string => {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (Number.isNaN(ms) || ms <= 0) return ''
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d${Math.floor((ms % DAY) / HOUR)}h`
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h${Math.floor((ms % HOUR) / MINUTE)}m`
  return `${Math.max(1, Math.floor(ms / MINUTE))}m`
}

/** A token count as the status line says it: 950, 84k, 1.2M. */
export const tokenCount = (n: number): string =>
  n < 1_000 ? String(Math.round(n)) : n < 1_000_000 ? `${Math.round(n / 1_000)}k` : `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`

export type Meter = { label: string; bar: string; percent: string; reset: string; level: Level; detail?: string }

/** The context window's fill as a meter, `84k/200k` beside it; null before a response has reported one. */
export function contextMeter(c: Usage['context']): Meter | null {
  if (!c?.window) return null
  const pct = c.percent ?? (c.tokens === undefined ? undefined : (c.tokens / c.window) * 100)
  if (pct === undefined) return null
  return {
    label: '上下文',
    bar: bar(pct),
    percent: `${Math.round(pct)}%`,
    reset: '',
    level: levelOf(pct),
    ...(c.tokens === undefined ? {} : { detail: `${tokenCount(c.tokens)}/${tokenCount(c.window)}` }),
  }
}

// The context meter first (when asked for and read), then one per rate-limit window with a fresh reading; empty means draw nothing.
export const meters = (u: Usage, now: number, withContext = false): Meter[] => [
  ...(withContext ? [contextMeter(u.context)].filter((m): m is Meter => m !== null) : []),
  ...rateMeters(u, now),
]

const rateMeters = (u: Usage, now: number): Meter[] =>
  u.rateLimits
    .filter(r => isFresh(r.resetsAt, now))
    .map(r => {
      const reset = shortCountdown(r.resetsAt, now)
      return {
        label: LABELS[r.kind] ?? r.kind,
        bar: bar(r.percentUsed),
        percent: `${Math.round(r.percentUsed)}%`,
        reset: reset && `↻${reset}`,
        level: levelOf(r.percentUsed),
      }
    })
