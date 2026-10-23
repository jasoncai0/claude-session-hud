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

type CliError = { type?: string; subtype?: string; code?: number; message?: string }

/** The `error` of the JSON a failed run printed (after any progress lines, on stdout or stderr); undefined without one. */
export function cliErrorOf(text: string): CliError | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  try {
    const error = (JSON.parse(text.slice(start)) as { error?: unknown }).error
    return error && typeof error === 'object' ? (error as CliError) : undefined
  } catch {
    return undefined
  }
}

const NOT_FOUND_RE = /not[_ ]?found/i
const MAX_REASON = 160

/**
 * Reads one `lark-cli drive +inspect` run. A success without a title, no access, and no such document (a deleted doc,
 * a made-up link) are final; any other failure (a timeout, a network error, a CLI that could not start) is tried again
 * later, with the CLI's own message as the reason.
 */
export function lookupOf(run: { exitCode: number; stdout: string; stderr: string } | { failed: string }): Lookup {
  if ('failed' in run) return { retry: run.failed }
  if (run.exitCode === 0) {
    const title = titleOf(run.stdout)
    const token = tokenOf(run.stdout)
    return title ? { title, ...(token ? { token } : {}) } : { final: '无标题' }
  }
  const error = cliErrorOf(run.stdout) ?? cliErrorOf(run.stderr)
  const text = `${run.stderr}\n${run.stdout}`
  if (error?.type === 'authorization' || /permission/i.test(error?.subtype ?? '') || (!error && /"type"\s*:\s*"authorization"|permission/i.test(text))) return { final: '无权限' }
  if (NOT_FOUND_RE.test(error?.subtype ?? '') || NOT_FOUND_RE.test(error?.message ?? '')) return { final: '不存在' }
  const lastLine = text.split('\n').map(l => l.trim()).filter(l => l && !/^[{}\]],?$/.test(l)).at(-1) ?? ''
  const reason = error?.message ?? lastLine
  return { retry: `lark-cli exit ${run.exitCode}: ${reason.slice(0, MAX_REASON)}` }
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
