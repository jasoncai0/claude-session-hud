import { expect, test } from 'claude-code/testing'

import type { DocLink } from '../../types'
import { findDocs, isCreation, isLarkTool, mergeDocs } from './links'
import { inspectArgv, isMissingProgram, lookupOf, titleOf } from './lookup'

const DOCX = 'https://acme.feishu.cn/docx/Doc0123456789abcdefABCD'
const WIKI = 'https://acme.larksuite.com/wiki/Wk1234567890abcd?from=share#h1'

test('findDocs extracts Feishu / Lark links, strips query and hash, dedupes by token', () => {
  const found = findDocs(`see ${DOCX} and ${WIKI}, again ${DOCX}?x=1`)
  expect(found).toEqual([
    { token: 'Doc0123456789abcdefABCD', kind: 'docx', url: DOCX },
    { token: 'Wk1234567890abcd', kind: 'wiki', url: 'https://acme.larksuite.com/wiki/Wk1234567890abcd' },
  ])
  expect(findDocs('https://github.com/a/b and https://feishu.cn.evil.com/docx/abcdefgh1234')).toEqual([])
})

test('findDocs takes a markdown link text as the label, not a bare URL', () => {
  expect(findDocs(`[权限设计](${DOCX})`)[0]?.label).toBe('权限设计')
  expect(findDocs(`[${DOCX}](${DOCX})`)[0]?.label).toBe(undefined)
})

test('findDocs skips non-document pages and reads mixed-case hosts', () => {
  expect(findDocs('https://x.feishu.cn/wiki/settings/7123456789 and https://x.feishu.cn/base/workspace/abc')).toEqual([])
  expect(findDocs('https://ACME.Feishu.CN/DOCX/Doc0123456789abcdefABCD')).toEqual([
    { token: 'Doc0123456789abcdefABCD', kind: 'docx', url: 'https://acme.feishu.cn/docx/Doc0123456789abcdefABCD' },
  ])
})

test('isCreation and isLarkTool recognise lark-cli and Lark MCP tools', () => {
  expect(isCreation('Bash', { command: 'lark-cli docs +create --title x' })).toBe(true)
  expect(isCreation('Bash', { command: 'lark-cli docs +fetch --url x' })).toBe(false)
  expect(isCreation('Bash', { command: 'lark-cli --as user docs +create --title x' })).toBe(true)
  expect(isCreation('Bash', { command: 'lark-cli docs +fetch --url x; echo +create' })).toBe(false)
  expect(isCreation('mcp__lark__docx_create', {})).toBe(true)
  expect(isLarkTool('Bash', { command: 'cd /x && lark-cli drive +inspect' })).toBe(true)
  expect(isLarkTool('Bash', { command: 'ls' })).toBe(false)
  expect(isLarkTool('Read', {})).toBe(false)
})

test('mergeDocs puts the newest first, keeps titles, and created outranks mentioned', () => {
  const old: DocLink[] = [{ token: 'A', url: 'u/A', kind: 'docx', origin: 'created', at: 1, title: 'Alpha', isLookedUp: true }]
  const merged = mergeDocs(old, [{ token: 'B', url: 'u/B', kind: 'wiki' }, { token: 'A', url: 'u/A2', kind: 'docx', label: '这里' }], 'mentioned', 5)
  expect(merged.map(d => d.token)).toEqual(['B', 'A'])
  expect(merged[1]).toEqual({ token: 'A', url: 'u/A', kind: 'docx', origin: 'created', at: 5, title: 'Alpha', label: '这里', isLookedUp: true })
  expect(merged[0]?.origin).toBe('mentioned')
  expect(old[0]?.at).toBe(1)
})

test('mergeDocs drops only mentions past the cap, never a created doc', () => {
  const created: DocLink = { token: 'C', url: 'u/C', kind: 'docx', origin: 'created', at: 0 }
  const mentions = Array.from({ length: 40 }, (_, i) => ({ token: `M${i}`, url: `u/M${i}`, kind: 'docx' }))
  const merged = mergeDocs([created], mentions, 'mentioned', 1)
  expect(merged.filter(d => d.origin === 'mentioned')).toHaveLength(30)
  expect(merged.some(d => d.token === 'C')).toBe(true)
})

test('inspectArgv spells mindnote and doc links the way +inspect takes them', () => {
  expect(inspectArgv('lark-cli', 'https://a.feishu.cn/mindnotes/Tok12345678')).toEqual(['lark-cli', 'drive', '+inspect', '--url', 'https://a.feishu.cn/mindnote/Tok12345678', '--format', 'json'])
  expect(inspectArgv('x', 'https://a.feishu.cn/docs/Tok12345678')[4]).toBe('https://a.feishu.cn/doc/Tok12345678')
  expect(inspectArgv('x', 'https://a.feishu.cn/docx/Tok12345678')[4]).toBe('https://a.feishu.cn/docx/Tok12345678')
  expect(isMissingProgram(new Error('spawn lark-cli ENOENT'))).toBe(true)
  expect(isMissingProgram(new Error('timed out'))).toBe(false)
})

test('lookupOf: a title or no access is final; a timeout or other failure is retried', () => {
  expect(lookupOf({ exitCode: 0, stdout: '{"ok":true,"data":{"title":"设计"}}', stderr: '' })).toEqual({ title: '设计' })
  expect(lookupOf({ exitCode: 0, stdout: '{"ok":true,"data":{}}', stderr: '' })).toEqual({ final: '无标题' })
  expect(lookupOf({ exitCode: 3, stdout: '', stderr: 'Inspecting wiki node\n{"ok":false,"error":{"type":"authorization","subtype":"permission_denied"}}' })).toEqual({ final: '无权限' })
  expect('retry' in lookupOf({ exitCode: 1, stdout: '', stderr: 'network unreachable' })).toBe(true)
  expect(lookupOf({ failed: 'timed out' })).toEqual({ retry: 'timed out' })
})

test('titleOf reads lark-cli +inspect JSON and tolerates failures', () => {
  expect(titleOf('{"ok":true,"data":{"title":" 设计 ","token":"x"}}')).toBe('设计')
  expect(titleOf('{"ok":false,"data":{"title":"x"}}')).toBe(undefined)
  expect(titleOf('not json')).toBe(undefined)
})
