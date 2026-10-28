import { expect, test } from 'claude-code/testing'

import { displayWidth, fit } from './text'

test('displayWidth counts CJK as two cells', () => {
  expect(displayWidth('abc')).toBe(3)
  expect(displayWidth('待合并')).toBe(6)
  expect(displayWidth('a团b')).toBe(4)
})

test('fit leaves short text alone and cuts long text at the end', () => {
  expect(fit('short', 10)).toBe('short')
  expect(fit('feature/user-profile-api', 10)).toBe('feature/u…')
  expect(displayWidth(fit('feature/user-profile-api', 10))).toBe(10)
})

test('fit name keeps the last path segment when the whole path is cut', () => {
  expect(fit('ai-infra/agent-websocket', 24, 'name')).toBe('ai-infra/agent-websocket')
  expect(fit('backend/demo-api', 9, 'name')).toBe('demo-api')
  expect(fit('ai-infra/agent-websocket', 9, 'name')).toBe('agent-we…')
  expect(fit('plain-repo-name', 9, 'name')).toBe('plain-re…')
})

test('fit middle keeps both ends', () => {
  expect(fit('feature/user-profile-board', 21, 'middle')).toBe('feature/us…file-board')
  expect(displayWidth(fit('feature/user-profile-board', 21, 'middle'))).toBe(21)
})

test('fit never splits a wide character past the width', () => {
  const cut = fit('用户资料权限设计方案', 7)
  expect(cut).toBe('用户资…')
  expect(displayWidth(cut) <= 7).toBe(true)
  expect(fit('团队', 1)).toBe('…')
  expect(fit('团队', 0)).toBe('')
})
