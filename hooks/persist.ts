import type { DeployRun, DocLink } from '../types'

/**
 * What a session's band is made of and cannot be fetched again: the repos it touched, the MRs / docs / releases it
 * linked or made, what was hidden, and the fold. `$.state` holds it for the process only (a hot reload keeps it, a
 * restart does not); this is the part written to `$.store` so a resumed session (the desktop app updated, an idle
 * session's process let go) shows it again. Fetched views (MR rows, usage) are read again on start.
 */
export type Saved = {
  mrDirs: string[]
  mrPinned: { repoPath: string; localId: number; forge?: 'github' }[]
  mrDismissed: string[]
  docs: DocLink[]
  docsDismissed: string[]
  deploys: DeployRun[]
  deployDismissed: string[]
  collapsed: boolean | null
}

export type Snapshot = { savedAt: number; state: Saved }

export const SNAPSHOT_PREFIX = 'session:'
/** Sessions kept in the store, newest first; the store's whole file is capped at 4 MiB. */
const KEPT_SESSIONS = 30
/** When the store is full, how many of the newest to keep. */
const KEPT_WHEN_FULL = 10
const MAX_AGE_MS = 30 * 24 * 60 * 60_000

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const objectsWith = <T,>(v: unknown, field: string): T[] =>
  Array.isArray(v) ? (v.filter(x => isObject(x) && typeof x[field] === 'string') as T[]) : []

export const isEmpty = (s: Saved): boolean =>
  !s.mrDirs.length && !s.mrPinned.length && !s.docs.length && !s.deploys.length
  && !s.mrDismissed.length && !s.docsDismissed.length && !s.deployDismissed.length && s.collapsed === null

/** A stored snapshot read back, each list kept to well-formed entries; null when it is not one. */
export function snapshotOf(value: unknown): Snapshot | null {
  if (!isObject(value) || typeof value.savedAt !== 'number' || !isObject(value.state)) return null
  const s = value.state
  return {
    savedAt: value.savedAt,
    state: {
      mrDirs: strings(s.mrDirs),
      mrPinned: Array.isArray(s.mrPinned) ? (s.mrPinned.filter(p => isObject(p) && typeof p.repoPath === 'string' && typeof p.localId === 'number') as Saved['mrPinned']) : [],
      mrDismissed: strings(s.mrDismissed),
      docs: objectsWith<DocLink>(s.docs, 'token'),
      docsDismissed: strings(s.docsDismissed),
      deploys: objectsWith<DeployRun>(s.deploys, 'key'),
      deployDismissed: strings(s.deployDismissed),
      collapsed: typeof s.collapsed === 'boolean' ? s.collapsed : null,
    },
  }
}

/** The snapshot keys to drop: past the newest `KEPT_SESSIONS` (or `KEPT_WHEN_FULL` when full), or older than 30 days. */
export function staleKeys(saved: readonly { key: string; savedAt: number }[], now: number, isFull = false): string[] {
  const kept = isFull ? KEPT_WHEN_FULL : KEPT_SESSIONS
  const newest = [...saved].sort((a, b) => b.savedAt - a.savedAt)
  return newest.filter((s, i) => i >= kept || now - s.savedAt > MAX_AGE_MS).map(s => s.key)
}
