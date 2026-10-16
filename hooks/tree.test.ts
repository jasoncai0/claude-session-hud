import { expect, test } from 'claude-code/testing'

import { isBlank } from './tree'

test('isBlank sees empty and whitespace-only trees as blank', () => {
  expect(isBlank(null)).toBe(true)
  expect(isBlank(undefined)).toBe(true)
  expect(isBlank(' ')).toBe(true)
  expect(isBlank({ type: 'Box', children: [] } as never)).toBe(true)
  expect(isBlank({ type: 'Box', children: [{ type: 'Text', children: [''] }] } as never)).toBe(true)
})

test('isBlank keeps any visible content', () => {
  expect(isBlank('MR !12')).toBe(false)
  expect(isBlank({ type: 'Box', children: [{ type: 'Text', children: ['MR !12'] }] } as never)).toBe(false)
  expect(isBlank({ type: 'Button', label: 'open' } as never)).toBe(false)
})
