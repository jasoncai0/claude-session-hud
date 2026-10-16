import type { MrView, RepoView } from '../../types'

const MERGE = '🔀'
const MAX_DIRS = 20

export const mrKey = (mr: Pick<MrView, 'repo' | 'id'>) => `${mr.repo}!${mr.id}`

/** Directories a tool call works in: an edited file's folder, a Bash `cd X` or `git -C X`. */
export function dirsOf(tool: string, input: { file_path?: unknown; notebook_path?: unknown; command?: unknown }, home: string): string[] {
  const file = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined
  if (file && tool !== 'Read') return [file.slice(0, file.lastIndexOf('/')) || '/']
  if (tool !== 'Bash' || typeof input.command !== 'string') return []
  const found = [...input.command.matchAll(/(?:^|[\s;&|(])(?:cd|git\s+-C)\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/g)]
  return found
    .map(m => (m[1] ?? '').replace(/^(['"])(.*)\1$/, '$2').replace(/^~(?=\/|$)/, home))
    .filter(d => d.startsWith('/'))
}

/** Adds dirs, deduped, newest last, capped. */
export function rememberDirs(known: readonly string[], added: readonly string[]): string[] {
  const merged = [...known.filter(d => !added.includes(d)), ...added]
  return merged.slice(-MAX_DIRS)
}

/** `/mr` output: one markdown line per MR, linked. */
export function mrList(repos: readonly RepoView[], label: (state: string) => string): string {
  const lines = repos.flatMap(r => r.mrs.map(mr =>
    `- ${MERGE} **${r.repo}** [!${mr.id} ${mr.title}](${mr.url}) · ${label(mr.state)} · \`${mr.source}\` → \`${mr.target}\``,
  ))
  return lines.length ? lines.join('\n') : '当前会话涉及的 Codeup 仓库分支没有 MR。'
}
