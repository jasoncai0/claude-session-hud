import type { DocLink, DocOrigin } from '../../types'

const HOSTS = String.raw`[\w-]+(?:\.[\w-]+)*\.(?:feishu\.cn|larksuite\.com|larkoffice\.com|feishu\.net)`
const KINDS = 'docx|docs|doc|wiki|sheets|sheet|base|bitable|mindnotes|mindnote|slides|file'
// The token must end the path segment: `/wiki/settings/123` is a page, not the document `settings`.
const URL_RE = new RegExp(String.raw`https?://(${HOSTS})/(${KINDS})/([A-Za-z0-9]{8,})(?![\w/-])`, 'gi')
const MD_LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]+)\)/g
const CREATE_RE = /\blark-cli\b[^\n;&|]*?\s\+(?:create|import|copy|duplicate)\b/
/** Mentions kept per session; created documents are always kept. */
const MAX_MENTIONED = 30

export type FoundDoc = { token: string; url: string; kind: string; label?: string; title?: string }

export const KIND_LABELS: Record<string, string> = {
  docx: '文档', docs: '文档', doc: '文档', wiki: '知识库', sheets: '表格', sheet: '表格',
  base: '多维表', bitable: '多维表', mindnotes: '脑图', mindnote: '脑图', slides: '幻灯片', file: '文件',
  artifact: 'Claude',
}

/** The kind a Claude Artifact (a page published to claude.ai) is filed under. */
export const ARTIFACT = 'artifact'
/** claude.ai/code/artifact/<uuid> or claude.ai/artifact/<id>: the id is the dedupe key. */
const ARTIFACT_RE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9][A-Za-z0-9-]{7,})/g
/** The head of an Artifact `read` result: `[Artifact <id> "<title>" — …`. */
const ARTIFACT_READ_RE = /^\[Artifact ([A-Za-z0-9-]+) "([^"\n]{1,300})"/
/** Artifact actions whose links name the artifact being worked on; `list` and the rest print other links. */
const ARTIFACT_NAMING = new Set(['publish', 'read', 'open'])

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

/** Every Claude Artifact linked in `text`, deduped by id; a markdown link's text is its label. */
export function findArtifacts(text: string): FoundDoc[] {
  const labels = new Map<string, string>()
  for (const [, label, url] of text.matchAll(MD_LINK_RE)) {
    const id = [...(url ?? '').matchAll(ARTIFACT_RE)][0]?.[1]
    const shown = label?.trim()
    if (id && shown && !/^https?:\/\//i.test(shown)) labels.set(id, shown)
  }
  const found = new Map<string, FoundDoc>()
  for (const [url, id] of text.matchAll(ARTIFACT_RE)) {
    if (!id || found.has(id)) continue
    const label = labels.get(id)
    found.set(id, { token: id, kind: ARTIFACT, url, ...(label ? { label } : {}) })
  }
  return [...found.values()]
}

/** Feishu / Lark documents and Claude Artifacts linked in `text`. */
export const findAllDocs = (text: string, withArtifacts: boolean): FoundDoc[] => [...findDocs(text), ...(withArtifacts ? findArtifacts(text) : [])]

/** The title an HTML page names in its `<title>`, entities left as written. */
export const htmlTitle = (html: string): string | undefined => html.match(/<title[^>]*>\s*([^<]{1,300}?)\s*<\/title>/i)?.[1]

/**
 * What an Artifact call made or named. A publish made the page its output links (`Published … at <url>`), titled by its
 * file's `<title>` (`pageTitle`), the call's `title`, else the file's name; a read or open names the artifact it was given, titled by the
 * read's header. Other actions (`list`, `delete`, …) count for nothing. A Claude Docs connector call that creates
 * (`container.create` in its input) made the artifacts its output links.
 */
export function artifactsOfCall(tool: string, input: Record<string, unknown>, output: string, pageTitle?: string): { made: FoundDoc[]; mentioned: FoundDoc[] } {
  if (tool === 'Artifact') {
    const action = typeof input.action === 'string' ? input.action : 'publish'
    if (!ARTIFACT_NAMING.has(action) || input.asset === true) return { made: [], mentioned: [] }
    if (action === 'publish') {
      const fileName = typeof input.file_path === 'string' ? input.file_path.split('/').at(-1)?.replace(/\.[^.]+$/, '') : undefined
      const title = pageTitle ?? (typeof input.title === 'string' && input.title ? input.title : undefined) ?? (fileName || undefined)
      return { made: findArtifacts(output).slice(0, 1).map(d => (title ? { ...d, title } : d)), mentioned: [] }
    }
    const header = output.match(ARTIFACT_READ_RE)
    const named = findArtifacts(JSON.stringify(input)).map(d => (header?.[2] && d.token === header[1] ? { ...d, title: header[2] } : d))
    return { made: [], mentioned: named }
  }
  const isDocsCreate = tool.startsWith('mcp__') && /"create"\s*:/.test(JSON.stringify(input))
  return isDocsCreate ? { made: findArtifacts(output), mentioned: [] } : { made: [], mentioned: findArtifacts(JSON.stringify(input)) }
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
    const title = f.title ?? old?.title
    return {
      ...old,
      token: f.token,
      url: old?.url ?? f.url,
      kind: f.kind,
      origin: old?.origin === 'created' || origin === 'created' ? 'created' : 'mentioned',
      at: now,
      ...(label ? { label } : {}),
      ...(title ? { title } : {}),
      // An artifact's title comes with it or not at all: there is nothing to look it up with.
      ...(f.kind === ARTIFACT ? { isLookedUp: true } : {}),
    }
  })
  const tokens = new Set(fresh.map(d => d.token))
  const all = [...fresh, ...known.filter(d => !tokens.has(d.token))]
  const keptMentions = new Set(all.filter(d => d.origin === 'mentioned').slice(0, MAX_MENTIONED).map(d => d.token))
  return all.filter(d => d.origin === 'created' || keptMentions.has(d.token))
}
