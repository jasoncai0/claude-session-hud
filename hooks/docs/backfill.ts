import { artifactsOfCall, findDocs, isCreation } from './links'

/**
 * What picks a session's transcript lines worth reading for documents it made: a document or artifact link, a create
 * call, or a Lark / Artifact tool. Everything else (most of the transcript) is left to grep.
 */
export const CREATION_LINES_RE = String.raw`feishu\.cn|larksuite\.com|larkoffice\.com|feishu\.net|claude\.ai/(code/)?artifact|\+(create|import|copy|duplicate)|"name":"[^"]*(lark|feishu|Artifact)[^"]*"`

type ToolUse = { name: string; input: Record<string, unknown> }
type Block = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean; text?: string }

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.map(c => (typeof (c as Block).text === 'string' ? (c as Block).text : JSON.stringify(c))).join('\n')
      : JSON.stringify(content ?? '')

const blocksOf = (line: string): Block[] => {
  try {
    const content = (JSON.parse(line) as { message?: { content?: unknown } }).message?.content
    return Array.isArray(content) ? (content as Block[]) : []
  } catch {
    return []
  }
}

/**
 * The documents a session's own calls made, read back from its transcript lines: a create call's output links that its
 * input did not name, and the Artifacts it published. What the live hooks would have marked 创建, for a session whose
 * marks were lost (a restart before they were saved, a fork that started over).
 */
export function createdInTranscript(lines: string): Set<string> {
  const uses = new Map<string, ToolUse>()
  const made = new Set<string>()
  for (const line of lines.split('\n')) {
    for (const b of blocksOf(line)) {
      if (b.type === 'tool_use' && b.id && b.name) uses.set(b.id, { name: b.name, input: (b.input ?? {}) as Record<string, unknown> })
      if (b.type !== 'tool_result' || b.is_error || !b.tool_use_id) continue
      const use = uses.get(b.tool_use_id)
      if (!use) continue
      const output = textOf(b.content)
      const asked = new Set(findDocs(JSON.stringify(use.input)).map(d => d.token))
      const lark = isCreation(use.name, use.input as { command?: unknown }) ? findDocs(output).filter(d => !asked.has(d.token)) : []
      for (const d of [...lark, ...artifactsOfCall(use.name, use.input, output).made]) made.add(d.token)
    }
  }
  return made
}
