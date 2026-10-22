import type { Check, CheckStatus, MrView } from '../../types'
import { LIST_MAX } from '../settings'

export const API_BASE = 'https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations'
export const TOKEN_VAR = 'ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN'
const CLOSED_STATES = new Set(['MERGED', 'CLOSED'])

export type Repo = { org: string; path: string }

/** git@codeup.aliyun.com:ORG/group/repo.git | https://[user@]codeup.aliyun.com/ORG/group/repo(.git) */
export function parseRemote(url: string): Repo | null {
  const m = url.trim().match(/^(?:git@codeup\.aliyun\.com:|(?:ssh|https?):\/\/(?:[^@/]+@)?codeup\.aliyun\.com(?::\d+)?\/)(.+?)(?:\.git)?\/?$/)
  const path = m?.[1]
  const org = path?.split('/')[0]
  return path && org && path.includes('/') ? { org, path } : null
}

/** Value of the last `export ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN=...` line in a shell profile. */
export function tokenFromProfile(text: string): string | undefined {
  return exportFromProfile(text, TOKEN_VAR)
}

/** Value of the last `export <name>=...` line in a shell profile, quotes and trailing comment stripped. */
export function exportFromProfile(text: string, name: string): string | undefined {
  const lines = text.split('\n').filter(l => new RegExp(`^\\s*export\\s+${name}=`).test(l))
  const raw = lines.at(-1)?.replace(/^[^=]*=/, '').replace(/\s+#.*$/, '').trim()
  const value = raw?.replace(/^(['"])(.*)\1$/, '$2')
  return value || undefined
}

type ApiReviewer = { reviewOpinionStatus?: string }
export type ApiChangeRequest = {
  localId: number
  /** `userId` is the platform user id (`platform/user`'s `id`). */
  author?: { userId?: string }
  createdAt?: string
  updatedAt?: string
  detailUrl: string
  title: string
  sourceBranch: string
  targetBranch: string
  state: string
  hasConflict?: boolean
  reviewers?: ApiReviewer[]
  unResolvedCommentCount?: number
}
type ApiCheckItem = { itemType: string; pass?: boolean }
export type ApiDetail = {
  checkList?: { requirementRuleItems?: ApiCheckItem[]; needAttentionItems?: ApiCheckItem[] }
  /** Source commits the target does not have yet. */
  ahead?: number
  /** Target commits the source does not have: how far the branch is behind. */
  behind?: number
}
export type ApiCompare = { diffs?: { diff?: string }[] }

export const isOpen = (cr: ApiChangeRequest) => !CLOSED_STATES.has(cr.state)

/** An MR the session made or named, pinned to the band whatever branch its checkout is on. */
/**
 * An MR shown whatever branch is checked out: one the session opened (`created`), one asked for with `/mr <link>`
 * (`tracked`), or one it came across (`mentioned`: a link in a message, an answer, a command's output; a pin without
 * `via` is an older version's, read the same). A mentioned one shows only when it is the user's own and opened since
 * the session began: the work of this feature, a helper session's included, not an MR looked at while investigating.
 */
export type MrPin = { repoPath: string; localId: number; forge?: 'github'; via?: PinVia }
export type PinVia = 'created' | 'tracked' | 'mentioned'

const MR_URL_RE = /https?:\/\/codeup\.aliyun\.com\/((?:[\w.-]+\/)+[\w.-]+?)\/change\/(\d+)/g
/** A call that opens an MR: the devops CLI, a POST to the changeRequests API, or a push option asking Codeup to. */
const MR_CREATE_RE = /\bcodeup-create-change-request\b|\bmerge_request\.create\b|\/changeRequests\b[^\n]*(?:-X\s*POST|--request\s+POST)|(?:-X\s*POST|--request\s+POST)[^\n]*\/changeRequests\b|\bgh\s+pr\s+create\b|\/pulls\b[^\n]*(?:-X\s*POST|--method\s+POST)/

/** Every Codeup MR page linked in `text`, deduped. */
export function findMrLinks(text: string): MrPin[] {
  const found = new Map<string, MrPin>()
  for (const [, repoPath, id] of text.matchAll(MR_URL_RE)) {
    if (repoPath && id && repoPath.includes('/')) found.set(`${repoPath}!${id}`, { repoPath, localId: Number(id) })
  }
  return [...found.values()]
}

/** A tool call that opens an MR / PR, however it is spelled: a Codeup one is then looked up by author and time. */
export function isMrCreation(tool: string, input: { command?: unknown }): boolean {
  if (tool === 'Bash') return typeof input.command === 'string' && MR_CREATE_RE.test(input.command)
  return /codeup/i.test(tool) && /create/i.test(tool) && /change|merge/i.test(tool)
}

/** The MRs in an author's newest-first list created at or after `since` (epoch ms): what one call just opened. */
export function createdSince(list: readonly ApiChangeRequest[], since: number): MrPin[] {
  return list.flatMap(cr => {
    const at = Date.parse(cr.createdAt ?? '')
    const pin = findMrLinks(cr.detailUrl)[0]
    return pin && !Number.isNaN(at) && at >= since ? [pin] : []
  })
}

/** Pins added, deduped, newest last. */
/** Whether a pin shows only when it is the user's own MR, opened since the session began. */
export const isMention = (p: MrPin): boolean => p.via !== 'created' && p.via !== 'tracked'

/** The user's own MR, opened at or after `since` (epoch ms): what a mention must be to show. */
export const isOwnSince = (author: string | undefined, me: string | undefined, createdAt: string | undefined, since: number): boolean =>
  Boolean(author && me && author === me) && Date.parse(createdAt ?? '') >= since

/** Pins added, deduped, newest last; a stronger reason (made, asked for) replaces a mention of the same MR. */
export const addPins = (known: readonly MrPin[], added: readonly MrPin[]): MrPin[] => {
  const key = (p: MrPin) => `${p.forge ?? 'codeup'}:${p.repoPath}!${p.localId}`
  const upgraded = known.map(k => {
    const better = added.find(a => key(a) === key(k) && isMention(k) && !isMention(a))
    return better ? { ...k, via: better.via } : k
  })
  const fresh = added.filter(p => !known.some(k => key(k) === key(p)))
  return [...upgraded, ...fresh].slice(-LIST_MAX)
}

/** Open MRs of the branch (newest first, capped); none open → the latest closed/merged one. */
export function pickMrs<T extends ApiChangeRequest>(list: readonly T[], branch: string): T[] {
  const mine = list.filter(cr => cr.sourceBranch === branch)
  const open = mine.filter(isOpen)
  return open.length ? open.slice(0, LIST_MAX) : mine.slice(0, 1)
}

/** +/- line counts of a Codeup compare, same as `git diff --shortstat target...source`. */
export function diffStat(compare: ApiCompare): { additions: number; deletions: number } {
  const lines = (compare.diffs ?? []).flatMap(d => (d.diff ?? '').split('\n'))
  return {
    additions: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
    deletions: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length,
  }
}

const CHECK_LABELS: Record<string, string> = { MERGE_CONFLICT_CHECK: '合并冲突检查' }

/** Merge requirements, conflict, reviews and unresolved comments as one checks list (the CI dropdown). */
/**
 * Where the branch stands: merged or how much is left to merge, how far it is behind its target, and whether the source
 * branch still exists (kept while open; worth deleting once merged). `isBranchAlive` undefined: not known, not shown.
 */
export function branchChecks(cr: ApiChangeRequest, detail: ApiDetail | undefined, isBranchAlive: boolean | undefined): Check[] {
  const isMerged = cr.state === 'MERGED'
  const merge: Check = isMerged
    ? { label: `已合入 ${cr.targetBranch}`, status: 'pass' }
    : !isOpen(cr)
      ? { label: '未合入（MR 已关闭）', status: 'fail' }
      : { label: detail?.ahead === undefined ? '待合入' : `待合入 ${detail.ahead} 个提交`, status: 'pending' }
  const behind = detail?.behind
  const sync: Check[] = !isOpen(cr) || behind === undefined ? []
    : [behind > 0 ? { label: `落后 ${cr.targetBranch} ${behind} 个提交`, status: 'pending' } : { label: `已同步 ${cr.targetBranch}`, status: 'pass' }]
  const branch: Check[] = isBranchAlive === undefined ? []
    : isOpen(cr)
      ? [isBranchAlive ? { label: '源分支存在', status: 'pass' } : { label: '源分支已删除', status: 'fail' }]
      : [isBranchAlive ? { label: '源分支未删除', status: 'pending' } : { label: '源分支已删除', status: 'pass' }]
  return [merge, ...sync, ...branch]
}

export function checksOf(cr: ApiChangeRequest, detail: ApiDetail | undefined, isBranchAlive?: boolean): Check[] {
  const rules = (detail?.checkList?.requirementRuleItems ?? []).map((it): Check => ({
    label: CHECK_LABELS[it.itemType] ?? it.itemType,
    status: it.pass ? 'pass' : 'fail',
  }))
  const attention = (detail?.checkList?.needAttentionItems ?? []).map((it): Check => ({ label: CHECK_LABELS[it.itemType] ?? it.itemType, status: 'fail' }))
  const reviewers = cr.reviewers ?? []
  const approved = reviewers.filter(r => r.reviewOpinionStatus === 'PASS').length
  const reviewStatus: CheckStatus = reviewers.some(r => r.reviewOpinionStatus === 'NOT_PASS') ? 'fail' : approved === reviewers.length ? 'pass' : 'pending'
  const reviews: Check[] = reviewers.length ? [{ label: `评审 ${approved}/${reviewers.length}`, status: reviewStatus }] : []
  const conflict: Check[] = cr.hasConflict && !rules.some(r => r.label === CHECK_LABELS.MERGE_CONFLICT_CHECK) ? [{ label: '存在冲突', status: 'fail' }] : []
  const unresolved = cr.unResolvedCommentCount ?? 0
  const comments: Check[] = unresolved ? [{ label: `未解决评论 ${unresolved}`, status: 'pending' }] : []
  return [...branchChecks(cr, detail, isBranchAlive), ...rules, ...attention, ...conflict, ...reviews, ...comments]
}

export function summarize(checks: readonly Check[]): CheckStatus | 'none' {
  if (!checks.length) return 'none'
  if (checks.some(c => c.status === 'fail')) return 'fail'
  return checks.some(c => c.status === 'pending') ? 'pending' : 'pass'
}

export function toView(cr: ApiChangeRequest, repoPath: string, detail?: ApiDetail, stats?: { additions: number; deletions: number }, isBranchAlive?: boolean): MrView {
  return {
    id: cr.localId,
    url: cr.detailUrl,
    title: cr.title,
    repo: repoLabel(repoPath),
    source: cr.sourceBranch,
    target: cr.targetBranch,
    state: cr.state,
    ...stats,
    checks: checksOf(cr, detail, isBranchAlive),
  }
}

/** `org/frontend/web-app` → `frontend/web-app`: group and name, without the org id. */
export function repoLabel(path: string): string {
  return path.split('/').slice(1).slice(-2).join('/') || path
}

/** 39230 → `39,230` */
export function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}


export type Tone = 'success' | 'warning' | 'error' | 'merged' | 'inactive'

const STATES: Record<string, { label: string; tone: Tone; hex: string }> = {
  UNDER_DEV: { label: '草稿', tone: 'inactive', hex: '#8c959f' },
  UNDER_REVIEW: { label: '评审中', tone: 'success', hex: '#1a7f37' },
  TO_BE_MERGED: { label: '待合并', tone: 'success', hex: '#1a7f37' },
  MERGED: { label: '已合并', tone: 'merged', hex: '#8250df' },
  CLOSED: { label: '已关闭', tone: 'error', hex: '#cf222e' },
}

export function stateOf(state: string): { label: string; tone: Tone; hex: string } {
  return STATES[state] ?? { label: state, tone: 'inactive', hex: '#8c959f' }
}

export const CHECK_GLYPH: Record<CheckStatus | 'none', { glyph: string; tone: Tone | undefined }> = {
  pass: { glyph: '✓', tone: 'success' },
  fail: { glyph: '✕', tone: 'error' },
  pending: { glyph: '○', tone: 'warning' },
  none: { glyph: '○', tone: undefined },
}

/** The pull-request glyph, stroked in the state's color. */
export function prIcon(hex: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="${hex}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="3.5" r="1.75"/><circle cx="4" cy="12.5" r="1.75"/><circle cx="12" cy="12.5" r="1.75"/><path d="M4 5.25v5.5M12 10.75V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6"/></svg>`
}
