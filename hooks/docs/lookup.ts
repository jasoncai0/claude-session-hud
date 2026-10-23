/** The Desktop app does not inherit the shell's PATH, so the usual install folders are tried after the bare name. */
export const LARK_CLI = ['lark-cli', '/opt/homebrew/bin/lark-cli', '/usr/local/bin/lark-cli'] as const

/** URL path kinds `+inspect` spells differently from the links people share. */
const INSPECT_KINDS: Record<string, string> = { mindnotes: 'mindnote', docs: 'doc' }

/** The argv that prints a document's type, title and canonical token as JSON (wiki nodes unwrapped). */
export function inspectArgv(bin: string, url: string): string[] {
  const fixed = url.replace(/\/(mindnotes|docs)\//, (_m, kind: string) => `/${INSPECT_KINDS[kind] ?? kind}/`)
  return [bin, 'drive', '+inspect', '--url', fixed, '--format', 'json']
}

/** A spawn failure that means "no such program here", so the next install folder is worth trying. */
export const isMissingProgram = (err: unknown): boolean => /ENOENT|not found|no such file/i.test(err instanceof Error ? err.message : String(err))

/** What one lookup came to: a title; a final no (no access, no such doc); or a failure worth trying again later. */
export type Lookup = { title: string; token?: string } | { final: string } | { retry: string }

/**
 * Reads one `lark-cli drive +inspect` run. An exit with an authorization error (no access) or a success without a
 * title is final; any other failure (a timeout, a network error, a CLI that could not start) is tried again later.
 */
export function lookupOf(run: { exitCode: number; stdout: string; stderr: string } | { failed: string }): Lookup {
  if ('failed' in run) return { retry: run.failed }
  if (run.exitCode === 0) {
    const title = titleOf(run.stdout)
    const token = tokenOf(run.stdout)
    return title ? { title, ...(token ? { token } : {}) } : { final: '无标题' }
  }
  const text = `${run.stderr}\n${run.stdout}`
  if (/"type"\s*:\s*"authorization"|permission/i.test(text)) return { final: '无权限' }
  return { retry: `lark-cli exit ${run.exitCode}: ${text.trim().split('\n').slice(-3).join(' ').slice(0, 160)}` }
}

/** Pulls `data.token` (the document's own, a wiki node unwrapped) out of `lark-cli drive +inspect` JSON. */
export function tokenOf(stdout: string): string | undefined {
  try {
    const token = (JSON.parse(stdout) as { data?: { token?: unknown } }).data?.token
    return typeof token === 'string' && token ? token : undefined
  } catch {
    return undefined
  }
}

/** Pulls `data.title` out of `lark-cli drive +inspect` JSON; undefined when the call failed or has none. */
export function titleOf(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { ok?: boolean; data?: { title?: unknown } }
    const title = parsed.ok === false ? undefined : parsed.data?.title
    return typeof title === 'string' && title.trim() ? title.trim() : undefined
  } catch {
    return undefined
  }
}
