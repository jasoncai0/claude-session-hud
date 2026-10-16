import type { DocLink, DocOrigin } from '../../types'

const HOSTS = String.raw`[\w-]+(?:\.[\w-]+)*\.(?:feishu\.cn|larksuite\.com|larkoffice\.com|feishu\.net)`
const KINDS = 'docx|docs|doc|wiki|sheets|sheet|base|bitable|mindnotes|mindnote|slides|file'
// The token must end the path segment: `/wiki/settings/123` is a page, not the document `settings`.
const URL_RE = new RegExp(String.raw`https?://(${HOSTS})/(${KINDS})/([A-Za-z0-9]{8,})(?![\w/-])`, 'gi')
const MD_LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]+)\)/g
const CREATE_RE = /\blark-cli\b[^\n;&|]*?\s\+(?:create|import|copy|duplicate)\b/
/** Mentions kept per session; created documents are always kept. */
const MAX_MENTIONED = 30

export type FoundDoc = { token: string; url: string; kind: string; label?: string }

export const KIND_LABELS: Record<string, string> = {
  docx: '文档', docs: '文档', doc: '文档', wiki: '知识库', sheets: '表格', sheet: '表格',
  base: '多维表', bitable: '多维表', mindnotes: '脑图', mindnote: '脑图', slides: '幻灯片', file: '文件',
}

/** Every Feishu / Lark document link in `text`, deduped by token; a markdown link's text is its label. */
export function findDocs(text: string): FoundDoc[] {
  const labels = new Map<string, string>()
  for (const [, label, url] of text.matchAll(MD_LINK_RE)) {
    const token = [...(url ?? '').matchAll(URL_RE)][0]?.[3]
    const shown = label?.trim()
    if (token && shown && !/^https?:\/\//i.test(shown)) labels.set(token, shown)
  }
  const found = new Map<string, FoundDoc>()
  for (const [, host, kind, token] of text.matchAll(URL_RE)) {
    if (!host || !kind || !token || found.has(token)) continue
    const label = labels.get(token)
    const k = kind.toLowerCase()
    found.set(token, { token, kind: k, url: `https://${host.toLowerCase()}/${k}/${token}`, ...(label ? { label } : {}) })
  }
  return [...found.values()]
}

/** A tool call that makes a document: `lark-cli [flags] <domain> +create|+import|+copy`, or a Lark MCP tool named so. */
export function isCreation(tool: string, input: { command?: unknown }): boolean {
  if (tool === 'Bash') return typeof input.command === 'string' && CREATE_RE.test(input.command)
  return /lark|feishu/i.test(tool) && /create|import|copy|duplicate/i.test(tool)
}

/** A tool call worth scanning for links: lark-cli in Bash, or a Lark / Feishu MCP tool. */
export function isLarkTool(tool: string, input: { command?: unknown }): boolean {
  if (tool === 'Bash') return typeof input.command === 'string' && /\blark-cli\b/.test(input.command)
  return /lark|feishu/i.test(tool)
}

/**
 * Adds what was found, newest first: `created` outranks `mentioned`, a looked-up title is never replaced, and only
 * mentions are dropped past the cap.
 */
export function mergeDocs(known: readonly DocLink[], found: readonly FoundDoc[], origin: DocOrigin, now: number): DocLink[] {
  const byToken = new Map(known.map(d => [d.token, d]))
  const fresh = found.map((f): DocLink => {
    const old = byToken.get(f.token)
    const label = f.label ?? old?.label
    return {
      ...old,
      token: f.token,
      url: old?.url ?? f.url,
      kind: f.kind,
      origin: old?.origin === 'created' || origin === 'created' ? 'created' : 'mentioned',
      at: now,
      ...(label ? { label } : {}),
    }
  })
  const tokens = new Set(fresh.map(d => d.token))
  const all = [...fresh, ...known.filter(d => !tokens.has(d.token))]
  const keptMentions = new Set(all.filter(d => d.origin === 'mentioned').slice(0, MAX_MENTIONED).map(d => d.token))
  return all.filter(d => d.origin === 'created' || keptMentions.has(d.token))
}
