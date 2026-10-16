import { expect, test } from 'claude-code/testing'

import { settingsOf } from '../settings'
import { mrLayout } from './view'

const DEFAULT = settingsOf({})

test('mrLayout keeps the configured widths when the band is wide enough', () => {
  expect(mrLayout(DEFAULT, 200)).toEqual(DEFAULT)
})

test('mrLayout shrinks repo / source / target in proportion to fit the band', () => {
  const s = mrLayout(DEFAULT, 100)
  expect(s.mrRepo).toBe(true)
  expect(s.mrSourceWidth < DEFAULT.mrSourceWidth).toBe(true)
  // 2 toggle + 44 fixed + 10 gaps leaves 44 for the three name columns
  expect(s.mrRepoWidth + s.mrSourceWidth + s.mrTargetWidth <= 44).toBe(true)
})

test('mrLayout drops the repo column before going below the minimum', () => {
  const s = mrLayout(DEFAULT, 70)
  expect(s.mrRepo).toBe(false)
  expect(s.mrSourceWidth >= 6 && s.mrTargetWidth >= 6).toBe(true)
  expect(mrLayout({ ...DEFAULT, mrStats: false, mrChecks: false }, 70).mrRepo).toBe(true)
})
