import type { Check, CheckStatus, MrView } from '../../types'
import type { MrPin } from './codeup'

/** A GitHub repository: owner and name. */
export type GhRepo = { owner: string; name: string }

const OPEN_SHOWN = 3
const CI_NAMES_SHOWN = 2
const PR_URL_RE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g
const CI_FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const CI_PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
/** Merge states in which an approved PR can be merged now. */
const MERGEABLE_NOW = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE'])

/** git@github.com:o/r.git | ssh://git@github.com/o/r | https://github.com/o/r(.git) */
export function parseGithubRemote(url: string): GhRepo | null {
  const m = url.trim().match(/^(?:git@github\.com:|(?:ssh|https?):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return m?.[1] && m[2] ? { owner: m[1], name: m[2] } : null
}

/** Every GitHub PR page linked in `text`, deduped, pinned as `forge: 'github'`. */
export function findPrLinks(text: string): MrPin[] {
  const found = new Map<string, MrPin>()
  for (const [, owner, name, n] of text.matchAll(PR_URL_RE)) {
    if (owner && name && n) found.set(`${owner}/${name}#${n}`, { repoPath: `${owner}/${name}`, localId: Number(n), forge: 'github' })
  }
  return [...found.values()]
}

const FIELDS = `fragment F on PullRequest {
  number url title state isDraft merged createdAt additions deletions
  headRefName baseRefName headRef { name } headRepositoryOwner { login }
  mergeable mergeStateStatus reviewDecision
  commits(last: 1) { totalCount nodes { commit { statusCheckRollup { state contexts(first: 50) { nodes {
    __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state }
  } } } } } }
  reviewThreads(first: 100) { nodes { isResolved } }
}`

/**
 * One query for a repo: the PRs from `branch` (newest first) and the PRs pinned by number, each aliased `n<number>`.
 * Names reach the query as JSON strings, which GraphQL reads as its own string literals.
 */
export function prQuery(repo: GhRepo, branch: string | undefined, numbers: readonly number[]): string {
  const byBranch = branch
    ? `branch: pullRequests(headRefName: ${JSON.stringify(branch)}, first: 5, states: [OPEN, MERGED, CLOSED], orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ...F } }`
    : ''
  const pinned = numbers.map(n => `n${n}: pullRequest(number: ${Math.trunc(n)}) { ...F }`).join('\n')
  return `query { repository(owner: ${JSON.stringify(repo.owner)}, name: ${JSON.stringify(repo.name)}) {\n${byBranch}\n${pinned}\n} }\n${FIELDS}`
}

type ApiContext = { __typename?: string; name?: string; context?: string; status?: string; conclusion?: string | null; state?: string }

export type ApiPr = {
  number: number
  url: string
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  merged: boolean
  additions: number
  deletions: number
  headRefName: string
  baseRefName: string
  headRef: { name: string } | null
  headRepositoryOwner?: { login: string } | null
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus: string
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  commits: { totalCount: number; nodes: { commit: { statusCheckRollup: { state: string; contexts: { nodes: ApiContext[] } } | null } }[] }
  reviewThreads: { nodes: { isResolved: boolean }[] }
}

/** The PRs in a query's answer: the branch's, then the pinned ones by alias; nulls (no such PR) dropped. */
export function prsOf(answer: unknown): { branch: ApiPr[]; pinned: ApiPr[] } {
  const repo = (answer as { data?: { repository?: Record<string, unknown> | null } } | null)?.data?.repository ?? {}
  const branch = ((repo.branch as { nodes?: ApiPr[] } | undefined)?.nodes ?? []).filter(Boolean)
  const pinned = Object.entries(repo).filter(([k, v]) => k.startsWith('n') && v).map(([, v]) => v as ApiPr)
  return { branch, pinned }
}

/** Open PRs of the branch (newest first, capped); none open → the latest merged / closed one. */
export function pickPrs(prs: readonly ApiPr[]): ApiPr[] {
  const open = prs.filter(p => p.state === 'OPEN')
  return open.length ? open.slice(0, OPEN_SHOWN) : prs.slice(0, 1)
}

/** The PR's state in the MR vocabulary the rows draw: 草稿, 评审中, 待合并, 已合并, 已关闭. */
export function prState(pr: ApiPr): string {
  if (pr.state === 'MERGED' || pr.merged) return 'MERGED'
  if (pr.state === 'CLOSED') return 'CLOSED'
  if (pr.isDraft) return 'UNDER_DEV'
  return pr.reviewDecision !== 'CHANGES_REQUESTED' && pr.reviewDecision !== 'REVIEW_REQUIRED' && MERGEABLE_NOW.has(pr.mergeStateStatus) ? 'TO_BE_MERGED' : 'UNDER_REVIEW'
}

/** The compare range that counts how far an open PR's head is behind its base (`base...owner:head`). */
export const compareRange = (pr: ApiPr): string => `${pr.baseRefName}...${pr.headRepositoryOwner?.login ? `${pr.headRepositoryOwner.login}:` : ''}${pr.headRefName}`

function ciCheck(pr: ApiPr): Check[] {
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup
  if (!rollup) return []
  const runs = rollup.contexts.nodes.map(c => ({
    name: c.name ?? c.context ?? 'check',
    result: c.__typename === 'StatusContext' ? (c.state === 'PENDING' || c.state === 'EXPECTED' ? 'PENDING' : c.state ?? 'PENDING') : c.status === 'COMPLETED' ? c.conclusion ?? 'PENDING' : 'PENDING',
  }))
  const failed = runs.filter(r => CI_FAILED.has(r.result))
  const done = runs.filter(r => CI_PASSED.has(r.result) || CI_FAILED.has(r.result)).length
  if (failed.length) {
    const names = failed.slice(0, CI_NAMES_SHOWN).map(r => r.name).join('、')
    return [{ label: `CI 失败：${names}${failed.length > CI_NAMES_SHOWN ? ` 等 ${failed.length} 项` : ''}`, status: 'fail' }]
  }
  if (done < runs.length) return [{ label: `CI 运行中 ${done}/${runs.length}`, status: 'pending' }]
  return [{ label: `CI 通过（${runs.length}）`, status: 'pass' }]
}

/**
 * The same checks the Codeup rows show, from what GitHub has: merged or commits left, commits behind the base, whether
 * the head branch still exists, conflicts, CI, the review decision and unresolved review threads.
 */
export function prChecks(pr: ApiPr, behind?: number): Check[] {
  const isMerged = pr.state === 'MERGED' || pr.merged
  const isOpen = pr.state === 'OPEN'
  const merge: Check = isMerged
    ? { label: `已合入 ${pr.baseRefName}`, status: 'pass' }
    : !isOpen ? { label: '未合入（PR 已关闭）', status: 'fail' } : { label: `待合入 ${pr.commits.totalCount} 个提交`, status: 'pending' }
  const sync: Check[] = !isOpen ? []
    : behind !== undefined ? [behind > 0 ? { label: `落后 ${pr.baseRefName} ${behind} 个提交`, status: 'pending' } : { label: `已同步 ${pr.baseRefName}`, status: 'pass' }]
      : pr.mergeStateStatus === 'BEHIND' ? [{ label: `落后 ${pr.baseRefName}`, status: 'pending' }] : []
  const isAlive = pr.headRef !== null
  const branch: Check = isOpen
    ? isAlive ? { label: '源分支存在', status: 'pass' } : { label: '源分支已删除', status: 'fail' }
    : isAlive ? { label: '源分支未删除', status: 'pending' } : { label: '源分支已删除', status: 'pass' }
  const conflict: Check[] = !isOpen || pr.mergeable === 'UNKNOWN' ? []
    : [pr.mergeable === 'CONFLICTING' ? { label: '存在冲突', status: 'fail' } : { label: '无冲突', status: 'pass' }]
  const reviews: Record<string, Check> = {
    APPROVED: { label: '评审通过', status: 'pass' },
    CHANGES_REQUESTED: { label: '评审要求修改', status: 'fail' },
    REVIEW_REQUIRED: { label: '待评审', status: 'pending' },
  }
  const review = pr.reviewDecision ? [reviews[pr.reviewDecision]].filter((c): c is Check => c !== undefined) : []
  const unresolved = pr.reviewThreads.nodes.filter(t => !t.isResolved).length
  const comments: Check[] = unresolved ? [{ label: `未解决评论 ${unresolved}`, status: 'pending' as CheckStatus }] : []
  return [merge, ...sync, branch, ...conflict, ...ciCheck(pr), ...review, ...comments]
}

/** A PR as a row: GitHub's `#number`, `owner/repo`, its +/- and checks. */
export function prView(pr: ApiPr, repo: GhRepo, behind?: number): MrView {
  return {
    id: pr.number,
    url: pr.url,
    title: pr.title,
    repo: `${repo.owner}/${repo.name}`,
    source: pr.headRefName,
    target: pr.baseRefName,
    state: prState(pr),
    additions: pr.additions,
    deletions: pr.deletions,
    checks: prChecks(pr, behind),
    forge: 'github',
  }
}
