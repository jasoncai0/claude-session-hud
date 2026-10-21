import { expect, test } from 'claude-code/testing'

import { isEmpty, snapshotOf, staleKeys } from './persist'

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
