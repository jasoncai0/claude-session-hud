import type { DeployRun, DocLink } from '../types'
import { foldSameDoc } from './docs/links'
import { LIST_MAX } from './settings'

/**
 * What a session's band is made of and cannot be fetched again: the repos it touched, the MRs / docs / releases it
 * linked or made, what was hidden, and the fold. `$.state` holds it for the process only (a hot reload keeps it, a
 * restart does not); this is the part written to `$.store` so a resumed session (the desktop app updated, an idle
 * session's process let go) shows it again. Fetched views (MR rows, usage) are read again on start.
 */
export type Saved = {
  mrDirs: string[]
  mrPinned: { repoPath: string; localId: number; forge?: 'github'; via?: 'created' | 'tracked' | 'mentioned' }[]
  mrDismissed: string[]
  docs: DocLink[]
  docsDismissed: string[]
  deploys: DeployRun[]
  deployDismissed: string[]
  collapsed: boolean | null
}

/**
 * `root` is the uuid of the session's first transcript row. A rewind or an edit in the desktop app goes on as a fork,
 * under a new session id, whose transcript keeps the rows (and their uuids) it forked from: the same root finds the
 * snapshots of the session it came from.
 */
export type Snapshot = { savedAt: number; root?: string; state: Saved }

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
    ...(typeof value.root === 'string' ? { root: value.root } : {}),
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

const unionBy = <T,>(first: readonly T[], second: readonly T[], key: (x: T) => string): T[] => {
  const seen = new Set(first.map(key))
  return [...first, ...second.filter(x => !seen.has(key(x)))]
}

/** `newer` with what only `older` holds added after it: each list by its key, the fold the newer one's when it has one. */
export function mergeSaved(newer: Saved, older: Saved): Saved {
  const same = (x: string) => x
  return {
    mrDirs: [...older.mrDirs.filter(d => !newer.mrDirs.includes(d)), ...newer.mrDirs].slice(-LIST_MAX),
    mrPinned: unionBy(newer.mrPinned, older.mrPinned, p => `${p.forge ?? ''}:${p.repoPath}!${p.localId}`),
    mrDismissed: unionBy(newer.mrDismissed, older.mrDismissed, same),
    // A doc either side made stays made: a fork that met it again only mentioned it.
    docs: foldSameDoc(unionBy(newer.docs, older.docs, d => d.token).map(d =>
      d.origin === 'mentioned' && older.docs.some(o => o.token === d.token && o.origin === 'created') ? { ...d, origin: 'created' as const } : d)),
    docsDismissed: unionBy(newer.docsDismissed, older.docsDismissed, same),
    deploys: unionBy(newer.deploys, older.deploys, r => r.key).slice(0, LIST_MAX),
    deployDismissed: unionBy(newer.deployDismissed, older.deployDismissed, same),
    collapsed: newer.collapsed ?? older.collapsed,
  }
}

/** The snapshots of one lineage (same `root`, or the session's own key), newest first, folded into one. */
export function lineageOf(entries: readonly { key: string; snap: Snapshot }[], ownKey: string, root: string | undefined): { state: Saved; keys: string[] } | null {
  const mine = entries.filter(e => e.key === ownKey || (root !== undefined && e.snap.root === root)).sort((a, b) => b.snap.savedAt - a.snap.savedAt)
  const [first, ...rest] = mine
  if (!first) return null
  return { state: rest.reduce((acc, e) => mergeSaved(acc, e.snap.state), first.snap.state), keys: mine.map(e => e.key) }
}

const CLI_SESSION_RE = /"cliSessionId"\s*:\s*"([\w-]+)"/g

/** The CLI session ids in the desktop app's metadata of its archived sessions (`"cliSessionId":"…"` lines). */
export const archivedIdsOf = (text: string): Set<string> => new Set([...text.matchAll(CLI_SESSION_RE)].flatMap(m => (m[1] ? [m[1]] : [])))

/**
 * The snapshot keys to drop: an archived session's, any past the newest `KEPT_SESSIONS` (`KEPT_WHEN_FULL` when the
 * store is full), and any older than 30 days.
 */
export function staleKeys(saved: readonly { key: string; savedAt: number }[], now: number, isFull = false, archived: ReadonlySet<string> = new Set()): string[] {
  const kept = isFull ? KEPT_WHEN_FULL : KEPT_SESSIONS
  const newest = [...saved].sort((a, b) => b.savedAt - a.savedAt)
  return newest
    .filter((s, i) => i >= kept || now - s.savedAt > MAX_AGE_MS || archived.has(s.key.slice(SNAPSHOT_PREFIX.length)))
    .map(s => s.key)
}
