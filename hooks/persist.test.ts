import { expect, test } from 'claude-code/testing'

import { archivedIdsOf, isEmpty, lineageOf, mergeSaved, snapshotOf, staleKeys } from './persist'
import type { Saved } from './persist'

const DAY = 24 * 60 * 60_000

test('snapshotOf reads a stored snapshot back, dropping malformed entries; anything else is null', () => {
  const snap = snapshotOf({
    savedAt: 5,
    state: {
      mrDirs: ['/w/a', 3], mrPinned: [{ repoPath: 'a/b', localId: 1 }, { repoPath: 'x' }],
      docs: [{ token: 't', url: 'u', kind: 'docx', origin: 'created', at: 1 }, {}], deploys: [{ key: 'k', app: 'a' }, 'x'],
      collapsed: true,
    },
  })
  expect(snap?.state.mrDirs).toEqual(['/w/a'])
  expect(snap?.state.mrPinned).toEqual([{ repoPath: 'a/b', localId: 1 }])
  expect(snap?.state.docs.map(d => d.token)).toEqual(['t'])
  expect(snap?.state.deploys.map(d => d.key)).toEqual(['k'])
  expect(snap?.state.mrDismissed).toEqual([])
  expect(snap?.state.collapsed).toBe(true)
  expect(snapshotOf(null)).toBe(null)
  expect(snapshotOf({ savedAt: 'x', state: {} })).toBe(null)
  expect(isEmpty(snapshotOf({ savedAt: 1, state: {} })?.state ?? ({} as never))).toBe(true)
})

test('staleKeys keeps the 30 newest within 30 days, or the 10 newest when the store is full', () => {
  const now = 100 * DAY
  const saved = Array.from({ length: 35 }, (_, i) => ({ key: `s${i}`, savedAt: now - i * 60_000 }))
  expect(staleKeys(saved, now)).toEqual(['s30', 's31', 's32', 's33', 's34'])
  expect(staleKeys(saved, now, true)).toHaveLength(25)
  expect(staleKeys([{ key: 'old', savedAt: now - 31 * DAY }, { key: 'new', savedAt: now }], now)).toEqual(['old'])
})

test('an archived session\'s snapshot is dropped, however new', () => {
  const archived = archivedIdsOf('"cliSessionId":"aaa-1"\n"cliSessionId": "bbb-2"\nnoise')
  expect([...archived]).toEqual(['aaa-1', 'bbb-2'])
  const saved = [{ key: 'session:aaa-1', savedAt: 10 }, { key: 'session:ccc-3', savedAt: 9 }]
  expect(staleKeys(saved, 10, false, archived)).toEqual(['session:aaa-1'])
})

const EMPTY: Saved = { mrDirs: [], mrPinned: [], mrDismissed: [], docs: [], docsDismissed: [], deploys: [], deployDismissed: [], collapsed: null }
const run = (key: string) => ({ key, app: key, workflowSn: '', stageSn: '', url: '', triggeredAt: 0 })

test('mergeSaved keeps the newer entries first and adds what only the older holds', () => {
  const newer: Saved = { ...EMPTY, mrDirs: ['/b'], deploys: [run('x')], collapsed: null }
  const older: Saved = { ...EMPTY, mrDirs: ['/a', '/b'], deploys: [run('y'), run('x')], mrPinned: [{ repoPath: 'o/r', localId: 1 }], collapsed: true }
  const m = mergeSaved(newer, older)
  expect(m.mrDirs).toEqual(['/a', '/b'])
  expect(m.deploys.map(r => r.key)).toEqual(['x', 'y'])
  expect(m.mrPinned).toHaveLength(1)
  expect(m.collapsed).toBe(true)
})

test('lineageOf folds the session\'s own snapshot with its forks\' by root, newest first; null with none', () => {
  const snap = (savedAt: number, root: string | undefined, dirs: string[]) => ({ savedAt, ...(root ? { root } : {}), state: { ...EMPTY, mrDirs: dirs } })
  const entries = [
    { key: 'session:old', snap: snap(1, 'r1', ['/old']) },
    { key: 'session:me', snap: snap(5, 'r1', ['/me']) },
    { key: 'session:x', snap: snap(9, 'r2', ['/x']) },
  ]
  expect(lineageOf(entries, 'session:me', 'r1')).toEqual({ state: { ...EMPTY, mrDirs: ['/old', '/me'] }, keys: ['session:me', 'session:old'] })
  expect(lineageOf(entries, 'session:new', 'r1')?.keys).toEqual(['session:me', 'session:old'])
  expect(lineageOf(entries, 'session:me', undefined)?.keys).toEqual(['session:me'])
  expect(lineageOf(entries, 'session:none', undefined)).toBe(null)
})

test('mergeSaved keeps a doc 创建 when the older side made it and the newer only mentioned it', () => {
  const d = (origin: 'created' | 'mentioned') => ({ token: 't', url: 'u', kind: 'docx', origin, at: 0 })
  expect(mergeSaved({ ...EMPTY, docs: [d('mentioned')] }, { ...EMPTY, docs: [d('created')] }).docs.map(x => x.origin)).toEqual(['created'])
  expect(mergeSaved({ ...EMPTY, docs: [d('mentioned')] }, { ...EMPTY, docs: [d('mentioned')] }).docs.map(x => x.origin)).toEqual(['mentioned'])
})
