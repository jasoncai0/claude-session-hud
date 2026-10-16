import { expect, test } from 'claude-code/testing'

import { bar, isFresh, levelOf, meters, shortCountdown } from './format'

const NOW = Date.parse('2026-10-14T10:00:00Z')

test('bar fills proportionally and clamps', () => {
  expect(bar(0)).toBe('░░░░░░')
  expect(bar(50)).toBe('███░░░')
  expect(bar(150)).toBe('██████')
  expect(bar(23.5, 10)).toBe('██░░░░░░░░')
})

test('level thresholds', () => {
  expect(levelOf(69.9)).toBe('success')
  expect(levelOf(70)).toBe('warning')
  expect(levelOf(90)).toBe('error')
})

test('shortCountdown units', () => {
  expect(shortCountdown('2026-10-14T13:32:00Z', NOW)).toBe('3h32m')
  expect(shortCountdown('2026-10-17T20:00:00Z', NOW)).toBe('3d10h')
  expect(shortCountdown('2026-10-14T10:05:00Z', NOW)).toBe('5m')
  expect(shortCountdown('2026-10-14T09:00:00Z', NOW)).toBe('')
  expect(shortCountdown(undefined, NOW)).toBe('')
  expect(shortCountdown('garbage', NOW)).toBe('')
})

test('isFresh keeps windows without a usable reset time', () => {
  expect(isFresh(undefined, NOW)).toBe(true)
  expect(isFresh('garbage', NOW)).toBe(true)
  expect(isFresh('2026-10-14T10:00:00Z', NOW)).toBe(false)
})

test('meters maps each fresh window', () => {
  const rows = meters(
    { rateLimits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-14T11:00:00Z' }, { kind: 'seven_day', percentUsed: 7 }] },
    NOW,
  )
  expect(rows).toEqual([
    { label: '5h', bar: '██████', percent: '92%', reset: '↻1h0m', level: 'error' },
    { label: '7d', bar: '░░░░░░', percent: '7%', reset: '', level: 'success' },
  ])
})

test('meters drops stale windows and is empty when none are fresh', () => {
  const rows = { rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: '2026-10-14T09:00:00Z' }, { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-10-18T00:00:00Z' }] }
  expect(meters(rows, NOW).map(m => m.label)).toEqual(['7d'])
  expect(meters({ rateLimits: [] }, NOW)).toEqual([])
})
