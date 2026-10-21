import { expect, test } from 'claude-code/testing'

import { createdInTranscript } from './backfill'

const NEW = 'https://acme.feishu.cn/docx/NewDoc1234567890abcd'
const REF = 'https://acme.feishu.cn/docx/RefDoc1234567890abcd'
const row = (role: 'user' | 'assistant', content: unknown[]) => JSON.stringify({ type: role, message: { role, content } })

test('createdInTranscript finds what a create call made, not what its input named, a read or a failure', () => {
  const lines = [
    row('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `lark-cli docs +create --as user --content "<a href='${REF}'>ref</a>"` } }]),
    row('user', [{ type: 'tool_result', tool_use_id: 't1', content: `True ${NEW} ${REF}` }]),
    row('assistant', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'lark-cli docs +fetch --doc x' } }]),
    row('user', [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'https://acme.feishu.cn/docx/ReadDoc123456789abcd' }] }]),
    row('assistant', [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'lark-cli docs +create --content x' } }]),
    row('user', [{ type: 'tool_result', tool_use_id: 't3', is_error: true, content: 'https://acme.feishu.cn/docx/FailDoc123456789abcd' }]),
    'not json',
  ].join('\n')
  expect([...createdInTranscript(lines)]).toEqual(['NewDoc1234567890abcd'])
})

test('createdInTranscript counts a published Artifact', () => {
  const art = 'https://claude.ai/code/artifact/38259d61-6573-4493-a61c-adce693a2b57'
  const lines = [
    row('assistant', [{ type: 'tool_use', id: 'a1', name: 'Artifact', input: { file_path: '/tmp/r.html' } }]),
    row('user', [{ type: 'tool_result', tool_use_id: 'a1', content: `Published /tmp/r.html at ${art}` }]),
  ].join('\n')
  expect([...createdInTranscript(lines)]).toEqual(['38259d61-6573-4493-a61c-adce693a2b57'])
})
