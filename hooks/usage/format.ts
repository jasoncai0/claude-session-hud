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

export type Meter = { label: string; bar: string; percent: string; reset: string; level: Level }

// One meter per window with a fresh reading; empty means draw nothing.
export const meters = (u: Usage, now: number): Meter[] =>
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
