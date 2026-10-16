import { expect, test } from 'claude-code/testing'

import { parseHud } from './hud'
import { DEFAULTS, parseSetting, settingsOf } from './settings'

test('settingsOf fills defaults and leaves the token out when unset', () => {
  const s = settingsOf({})
  expect(s.mr).toBe(true)
  expect(s.mrSourceWidth).toBe(DEFAULTS.mrSourceWidth)
  expect('token' in s).toBe(false)
})

test('settingsOf clamps numbers and ignores mistyped values', () => {
  const s = settingsOf({ mrMaxRows: 99, mrRepoWidth: 1, docsTitleWidth: '30', usage: 'yes', token: 'pt-x' })
  expect(s.mrMaxRows).toBe(10)
  expect(s.mrRepoWidth).toBe(6)
  expect(s.docsTitleWidth).toBe(30)
  expect(s.usage).toBe(true)
  expect(s.token).toBe('pt-x')
})

test('parseSetting reads on/off and clamped numbers', () => {
  expect(parseSetting('docs', 'off')).toEqual({ value: false })
  expect(parseSetting('docs', '开')).toEqual({ value: true })
  expect(parseSetting('mrPollSeconds', '5')).toEqual({ value: 15 })
  expect('error' in parseSetting('docs', 'maybe')).toBe(true)
  expect('error' in parseSetting('mrMaxRows', '')).toBe(true)
})

test('parseHud maps arguments to actions', () => {
  expect(parseHud('')).toEqual({ kind: 'status' })
  expect(parseHud('fold')).toEqual({ kind: 'fold', isCollapsed: true })
  expect(parseHud(' unfold ')).toEqual({ kind: 'fold', isCollapsed: false })
  expect(parseHud('mr off')).toEqual({ kind: 'set', key: 'mr', value: false })
  expect(parseHud('set mrSourceWidth 30')).toEqual({ kind: 'set', key: 'mrSourceWidth', value: 30 })
  expect(parseHud('set nope 1').kind).toBe('reply')
  expect(parseHud('mr').kind).toBe('reply')
  expect(parseHud('bogus').kind).toBe('reply')
})
