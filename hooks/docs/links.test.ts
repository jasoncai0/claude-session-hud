import { expect, test } from 'claude-code/testing'

import type { DocLink } from '../../types'
import { LIST_MAX } from '../settings'
import { artifactsOfCall, findAllDocs, findArtifacts, findDocs, foldSameDoc, htmlTitle, isCreation, isLarkTool, mergeDocs } from './links'
import { inspectArgv, isMissingProgram, lookupOf, titleOf, tokenOf } from './lookup'

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
  const mentions = Array.from({ length: LIST_MAX + 10 }, (_, i) => ({ token: `M${i}`, url: `u/M${i}`, kind: 'docx' }))
  const merged = mergeDocs([created], mentions, 'mentioned', 1)
  expect(merged.filter(d => d.origin === 'mentioned')).toHaveLength(LIST_MAX)
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
  // A made-up or deleted link: final, never retried (and so never logged).
  const notFound = 'Inspecting wiki node: Move...90ab\n' + JSON.stringify({ ok: false, error: { type: 'api', subtype: 'not_found', code: 131005, message: 'resolve wiki node failed: not found' } }, null, 2)
  expect(lookupOf({ exitCode: 1, stdout: notFound, stderr: '' })).toEqual({ final: '不存在' })
  // Any other failure says the CLI's own message, not the JSON's closing braces.
  const apiDown = JSON.stringify({ ok: false, error: { type: 'api', subtype: 'internal', message: 'upstream 502' } }, null, 2)
  expect(lookupOf({ exitCode: 1, stdout: apiDown, stderr: '' })).toEqual({ retry: 'lark-cli exit 1: upstream 502' })
  expect(lookupOf({ exitCode: 1, stdout: '', stderr: 'dial tcp: i/o timeout\n}' })).toEqual({ retry: 'lark-cli exit 1: dial tcp: i/o timeout' })
})

test('titleOf reads lark-cli +inspect JSON and tolerates failures', () => {
  expect(titleOf('{"ok":true,"data":{"title":" 设计 ","token":"x"}}')).toBe('设计')
  expect(titleOf('{"ok":false,"data":{"title":"x"}}')).toBe(undefined)
  expect(titleOf('not json')).toBe(undefined)
})

const ART = 'https://claude.ai/code/artifact/38259d61-6573-4493-a61c-adce693a2b57'
const ART_SHORT = 'https://claude.ai/artifact/AbCdEf123456'

test('findArtifacts reads both artifact link shapes, deduped, with a markdown label', () => {
  expect(findArtifacts(`see [评审报告](${ART}) and ${ART_SHORT}, again ${ART}`)).toEqual([
    { token: '38259d61-6573-4493-a61c-adce693a2b57', kind: 'artifact', url: ART, label: '评审报告' },
    { token: 'AbCdEf123456', kind: 'artifact', url: ART_SHORT },
  ])
  expect(findArtifacts('https://claude.ai/code/artifacts and https://claude.ai/chat/x')).toEqual([])
  expect(findAllDocs(`${DOCX} ${ART}`, false).map(d => d.kind)).toEqual(['docx'])
  expect(findAllDocs(`${DOCX} ${ART}`, true).map(d => d.kind)).toEqual(['docx', 'artifact'])
})

test('artifactsOfCall: a publish made its page, titled by its file; a read names its artifact with the header title', () => {
  const published = `Published /tmp/s/report.html at ${ART}\n\nTo get back to it later: ${ART_SHORT}`
  expect(artifactsOfCall('Artifact', { file_path: '/tmp/s/report.html' }, published, '评审报告')).toEqual({
    made: [{ token: '38259d61-6573-4493-a61c-adce693a2b57', kind: 'artifact', url: ART, title: '评审报告' }], mentioned: [],
  })
  expect(artifactsOfCall('Artifact', { title: '方案' }, published).made[0]?.title).toBe('方案')
  expect(artifactsOfCall('Artifact', { file_path: '/tmp/s/board-review.html' }, published).made[0]?.title).toBe('board-review')
  const read = `[Artifact 38259d61-6573-4493-a61c-adce693a2b57 "Board Review" — owned by you, private]\n<!doctype html>`
  expect(artifactsOfCall('Artifact', { action: 'read', url: ART }, read).mentioned[0]?.title).toBe('Board Review')
})

test('artifactsOfCall ignores listings and asset uploads; a Docs connector create made what it links; other tools name by input', () => {
  expect(artifactsOfCall('Artifact', { action: 'list' }, `${ART}\n${ART_SHORT}`)).toEqual({ made: [], mentioned: [] })
  expect(artifactsOfCall('Artifact', { url: ART, asset: true }, `uploaded to ${ART}`)).toEqual({ made: [], mentioned: [] })
  expect(artifactsOfCall('mcp__x__batch', { container: { kind: 'project', create: { name: 'n' } } }, `created ${ART_SHORT}`).made.map(d => d.token)).toEqual(['AbCdEf123456'])
  expect(artifactsOfCall('Bash', { command: `curl ${ART}` }, `other ${ART_SHORT}`).mentioned.map(d => d.token)).toEqual(['38259d61-6573-4493-a61c-adce693a2b57'])
})

test('htmlTitle reads a page title; an artifact merges as looked up, keeping a title it brings', () => {
  expect(htmlTitle('<html><head><title> 评审报告 </title></head>')).toBe('评审报告')
  expect(htmlTitle('<html></html>')).toBe(undefined)
  const merged = mergeDocs([], [{ token: 'a1b2c3d4e5', kind: 'artifact', url: ART, title: 'T' }], 'created', 1)
  expect(merged[0]).toEqual({ token: 'a1b2c3d4e5', url: ART, kind: 'artifact', origin: 'created', at: 1, title: 'T', isLookedUp: true })
})

test('foldSameDoc: a docx made here and the wiki node it was moved under are one row, kept as the wiki link, made', () => {
  const docx: DocLink = { token: 'DocX', url: 'u/docx/DocX', kind: 'docx', origin: 'created', at: 1, title: 'T', isLookedUp: true }
  const wiki: DocLink = { token: 'WikiN', url: 'u/wiki/WikiN', kind: 'wiki', origin: 'mentioned', at: 5, title: 'T', isLookedUp: true, docToken: 'DocX' }
  const other: DocLink = { token: 'Other', url: 'u/docx/Other', kind: 'docx', origin: 'mentioned', at: 3 }
  const folded = foldSameDoc([wiki, other, docx])
  expect(folded.map(d => `${d.kind}:${d.token}:${d.origin}`)).toEqual(['wiki:WikiN:created', 'docx:Other:mentioned'])
  expect(folded[0]?.docToken).toBe('DocX')
  expect(foldSameDoc([docx, other])).toHaveLength(2)
  // A later mention of the docx link finds the folded row by its alias / doc token, not a new row.
  const again = mergeDocs(folded, [{ token: 'DocX', url: 'u/docx/DocX', kind: 'docx' }], 'mentioned', 9)
  expect(again.map(d => d.token)).toEqual(['WikiN', 'Other'])
})

test('tokenOf reads the unwrapped document token from +inspect', () => {
  expect(tokenOf(JSON.stringify({ ok: true, data: { title: 't', token: 'JFeW', wiki_node: { node_token: 'U5eS' } } }))).toBe('JFeW')
  expect(tokenOf('not json')).toBe(undefined)
  expect(lookupOf({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { title: 't', token: 'JFeW' } }), stderr: '' })).toEqual({ title: 't', token: 'JFeW' })
})
