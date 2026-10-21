import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DeployRun, DocLink, DocOrigin, MrView, RepoView, SessionView, Usage } from '../types'
import { addRun, envOfStage, findStageTargets, isSettled, isUnnamed, pickExecution, pipelineLabel, runOf, stageOfPipeline, stageUrl, triggersOf } from './deploy/parse'
import type { ApiPipelineRun } from './deploy/parse'
import { deployList, deploySection } from './deploy/view'
import { artifactsOfCall, findAllDocs, findDocs, htmlTitle, isCreation, isLarkTool, mergeDocs } from './docs/links'
import type { FoundDoc } from './docs/links'
import { LARK_CLI, inspectArgv, isMissingProgram, lookupOf } from './docs/lookup'
import type { Lookup } from './docs/lookup'
import { docList, docsLayout, docsSection, visibleDocs } from './docs/view'
import { band, parseHud, status } from './hud'
import { API_BASE, addPins, createdSince, diffStat, exportFromProfile, findMrLinks, isMrCreation, isOpen, parseRemote, pickMrs, repoLabel, stateOf, toView, tokenFromProfile } from './mr/codeup'
import type { ApiChangeRequest, ApiCompare, ApiDetail, MrPin, Repo } from './mr/codeup'
import { mrKey } from './mr/session'
import { compareRange, findPrLinks, parseGithubRemote, pickPrs, prQuery, prView, prsOf } from './mr/github'
import type { ApiPr, GhRepo } from './mr/github'
import { dirsOf, keepLastMrs, mrList, rememberDirs } from './mr/session'
import { mrLayout, mrSection } from './mr/view'
import { SNAPSHOT_PREFIX, archivedIdsOf, isEmpty, snapshotOf, staleKeys } from './persist'
import type { Saved } from './persist'
import { LIST_MAX, MODULE_IDS, PLUGIN, settingsOf } from './settings'
import type { Settings } from './settings'
import { isBlank } from './tree'
import type { Fold, Section } from './ui'
import { usageSection } from './usage/view'

const usage = atom({ plugin: 'session-hud', key: 'usage' } as const, null)
const mrView = atom({ plugin: 'session-hud', key: 'mrView' } as const, null)
const mrDirs = atom({ plugin: 'session-hud', key: 'mrDirs' } as const, [])
const mrExpanded = atom({ plugin: 'session-hud', key: 'mrExpanded' } as const, null)
const mrDismissed = atom({ plugin: 'session-hud', key: 'mrDismissed' } as const, [])
const mrPinned = atom({ plugin: 'session-hud', key: 'mrPinned' } as const, [])
const docs = atom({ plugin: 'session-hud', key: 'docs' } as const, [])
const docsDismissed = atom({ plugin: 'session-hud', key: 'docsDismissed' } as const, [])
const collapsed = atom({ plugin: 'session-hud', key: 'collapsed' } as const, null)
const deploys = atom({ plugin: 'session-hud', key: 'deploys' } as const, [])
const deployExpanded = atom({ plugin: 'session-hud', key: 'deployExpanded' } as const, null)
const deployDismissed = atom({ plugin: 'session-hud', key: 'deployDismissed' } as const, [])
const expandedLists = atom({ plugin: 'session-hud', key: 'expandedLists' } as const, [])

const PAGE_SIZE = 100
/** An author's newest MRs read after a create call: more than one call opens. */
const AUTHOR_PAGE = 10
/** How much earlier than the create call an MR may be stamped and still be its (clock skew). */
const CREATE_SLACK_MS = 60_000
const HTTP_NOT_FOUND = 404
const GIT_TIMEOUT_MS = 5_000
const LARK_TIMEOUT_MS = 8_000
/** Exit status of a command that was not found. */
const NOT_FOUND = 127
/** Title lookups per turn: each is one lark-cli call. */
const LOOKUPS_PER_TURN = 5
/** Retryable lookup failures per document before its title is given up. */
const MAX_LOOKUP_TRIES = 3
const PROFILES = ['.zshrc', '.zshenv', '.zprofile', '.bashrc', '.profile']
/** The Desktop app does not inherit the shell's PATH: gh is also looked for in the usual install folders. */
const GH_CLI = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'] as const
const GH_TIMEOUT_MS = 15_000
const NO_GH = '未找到 gh CLI（安装后执行 gh auth login）'
const NO_TOKEN = '未找到云效 token（设置 ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN）'
const NO_ORG = '未找到云效组织 ID（设置 ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID）'
const ORG_VAR = 'ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID'
const APPSTACK_BASE = 'https://openapi-rdc.aliyuncs.com/oapi/v1/appstack/organizations'
const FLOW_BASE = 'https://openapi-rdc.aliyuncs.com/oapi/v1/flow/organizations'
const PLATFORM_USER = 'https://openapi-rdc.aliyuncs.com/oapi/v1/platform/user'
/** A just-triggered stage needs a moment before its execution is listed. */
const DEPLOY_FIRST_CHECK_MS = 5_000

const listOf = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

// ponytail: module-level caches; reset on reload, which is fine
const repoIds = new Map<string, number>()
const roots = new Map<string, string>()
/** +/- per `${repo}!${id}@${head sha}`: the diff is fetched again only when the branch moves. */
const stats = new Map<string, { additions: number; deletions: number }>()
let tokenCache: { value: string | undefined } | null = null
/** Kept once found; until then each call looks again, so a session that starts outside a Codeup repo still finds it. */
let orgCache: string | undefined
/** The token owner, read once: their id (to find the MRs they create) and the org they last used. */
let platformUser: { id?: string; lastOrganization?: string } | undefined
/** Flow pipeline names by id, read once: they name a run whose call did not (a loop over `$app`). */
const pipelineNames = new Map<string, string>()
/** Each app's `releaseWorkflows` answer, read once: it maps a Flow pipeline to its AppStack release stage. */
const appWorkflows = new Map<string, unknown>()
/** The gh that ran; null once none was found. */
let ghCli: string | null | undefined
/** Release-stage names per `${app}/${workflowSn}`, read once: they name a tracked run's env. */
const stageNames = new Map<string, Map<string, string>>()
/** Run keys being fetched, so a press during a poll does not fetch twice. */
const deployFetching = new Set<string>()
/** The lark-cli that ran; null once none was found. */
let larkCli: string | null | undefined
/** Tokens whose title lookup is running, so overlapping turns (subagents, fast prompts) never look one up twice. */
const lookingUp = new Set<string>()

/** Runs one module's step: a failure neither stops the other modules nor the event, and is logged. */
async function guard($: EngineInterface, id: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step()
  } catch (err) {
    $.ui.log(`${PLUGIN} ${id}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── usage ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function refreshUsage($: EngineInterface) {
  const u = await $.session.usage()
  const next: Usage = { rateLimits: u.rateLimits }
  await update($, usage, () => next)
}

// ── Codeup MR ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function git($: EngineInterface, dir: string, ...args: string[]): Promise<string> {
  const { exitCode, stdout } = await $.process.run(['git', '-C', dir, ...args], { timeoutMs: GIT_TIMEOUT_MS }).catch(() => ({ exitCode: 1, stdout: '' }))
  return exitCode === 0 ? stdout.trim() : ''
}

async function resolveToken($: EngineInterface, configured: string | undefined): Promise<string | undefined> {
  if (configured) return configured
  const fromEnv = await $.env.get('ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN')
  if (fromEnv) return fromEnv
  const home = await $.env.get('HOME')
  for (const name of PROFILES) {
    const token = tokenFromProfile(await $.fs.read(`${home}/${name}`).catch(() => ''))
    if (token) return token
  }
  return undefined
}

async function getJson<T>($: EngineInterface, token: string, url: string, what: string): Promise<T> {
  const res = await $.http.fetch(url, { headers: { 'x-yunxiao-token': token } })
  if (!res.ok) throw new Error(`${what} ${res.status}: ${res.text.slice(0, 120)}`)
  return JSON.parse(res.text) as T
}

const api = <T,>($: EngineInterface, token: string, path: string): Promise<T> => getJson<T>($, token, `${API_BASE}/${path}`, 'Codeup')

async function cachedToken($: EngineInterface, settings: Settings): Promise<string | undefined> {
  tokenCache ??= { value: await resolveToken($, settings.token) }
  return tokenCache.value
}

/** Whether the branch still exists on Codeup: 404 is deleted; any other failure is unknown, so no check is shown. */
async function isBranchAlive($: EngineInterface, token: string, base: string, branch: string): Promise<boolean | undefined> {
  const res = await $.http.fetch(`${API_BASE}/${base}/branches/${encodeURIComponent(branch)}`, { headers: { 'x-yunxiao-token': token } }).catch(() => null)
  if (!res) return undefined
  return res.ok ? true : res.status === HTTP_NOT_FOUND ? false : undefined
}

async function repoIdOf($: EngineInterface, token: string, repo: Repo): Promise<number> {
  const known = repoIds.get(repo.path)
  if (known !== undefined) return known
  const id = (await api<{ id: number }>($, token, `${repo.org}/repositories/${encodeURIComponent(repo.path)}`)).id
  repoIds.set(repo.path, id)
  return id
}

/** A repo's newest MRs. ponytail: Codeup ignores sourceBranch filtering, so scan the newest 100; page further if old branches matter */
async function repoMrs($: EngineInterface, token: string, repo: Repo): Promise<{ base: string; list: ApiChangeRequest[] }> {
  const repoId = await repoIdOf($, token, repo)
  const list = await api<ApiChangeRequest[]>($, token, `${repo.org}/changeRequests?projectIds=${repoId}&state=all&perPage=${PAGE_SIZE}`)
  return { base: `${repo.org}/repositories/${repoId}`, list }
}

/**
 * Rows for `crs`: detail checks, +/- stats (fetched again only when `versionOf` changes) and whether each source branch
 * still exists (one lookup per branch).
 */
async function mrViews($: EngineInterface, token: string, repo: Repo, base: string, crs: readonly ApiChangeRequest[], versionOf: (cr: ApiChangeRequest) => string): Promise<MrView[]> {
  const branches = [...new Set(crs.map(cr => cr.sourceBranch))]
  const alive = new Map(await Promise.all(branches.map(async b => [b, await isBranchAlive($, token, base, b)] as const)))
  // ponytail: the stats key ignores the target branch moving; add its sha if merged-in target commits must show
  return Promise.all(crs.map(async cr => {
    const key = `${repo.path}!${cr.localId}@${versionOf(cr)}`
    const [detail, stat] = await Promise.all([
      api<ApiDetail>($, token, `${base}/changeRequests/${cr.localId}`).catch(() => undefined),
      !isOpen(cr) ? undefined : stats.get(key) ?? api<ApiCompare>($, token, `${base}/compares?from=${encodeURIComponent(cr.targetBranch)}&to=${encodeURIComponent(cr.sourceBranch)}`)
        .then(diffStat)
        .then(s => (stats.set(key, s), s))
        .catch(() => undefined),
    ])
    return toView(cr, repo.path, detail, stat, alive.get(cr.sourceBranch))
  }))
}

async function fetchMrs($: EngineInterface, token: string, repo: Repo, branch: string, head: string): Promise<MrView[]> {
  const { base, list } = await repoMrs($, token, repo)
  return mrViews($, token, repo, base, pickMrs(list, branch), () => head)
}

/**
 * `gh <args>` parsed as JSON, through gh's own login. gh exits non-zero when a GraphQL answer carries errors next to
 * its data (a pinned number that is no PR), so stdout is read whatever the exit; only no JSON at all is a failure.
 */
async function ghJson($: EngineInterface, args: readonly string[]): Promise<unknown> {
  const candidates = ghCli === undefined ? GH_CLI : ghCli ? [ghCli] : []
  for (const bin of candidates) {
    const run = await $.process.run([bin, ...args], { timeoutMs: GH_TIMEOUT_MS }).catch((err: unknown) => (isMissingProgram(err) ? null : Promise.reject(err)))
    if (run === null || run.exitCode === NOT_FOUND) continue
    ghCli = bin
    try {
      return JSON.parse(run.stdout)
    } catch {
      throw new Error((run.stderr || run.stdout).trim().split('\n').slice(-1)[0]?.slice(0, 160) || `gh exit ${run.exitCode}`)
    }
  }
  if (candidates.length) ghCli = null
  throw new Error(NO_GH)
}

/** The PRs of `branch` (picked as for Codeup) and the PRs pinned by number, as rows, in one GraphQL call. */
async function githubPrs($: EngineInterface, repo: GhRepo, branch: string | undefined, numbers: readonly number[]): Promise<MrView[]> {
  const { branch: ofBranch, pinned } = prsOf(await ghJson($, ['api', 'graphql', '-f', `query=${prQuery(repo, branch, numbers)}`]))
  const prs = [...pickPrs(ofBranch), ...pinned.filter(p => !ofBranch.some(b => b.number === p.number))]
  return Promise.all(prs.map(async (pr: ApiPr) => {
    const behind = pr.state === 'OPEN'
      ? await ghJson($, ['api', `repos/${repo.owner}/${repo.name}/compare/${compareRange(pr)}`, '--jq', '{behind_by}'])
        .then(c => (c as { behind_by?: number }).behind_by)
        .catch(() => undefined)
      : undefined
    return prView(pr, repo, behind)
  }))
}

/** Rows for the pinned MRs not already shown, one group per repo; a repo that fails says so in its group. */
async function pinnedViews($: EngineInterface, token: string | undefined, pins: readonly MrPin[], shown: ReadonlySet<string>): Promise<RepoView[]> {
  const ghPins = pins.filter(p => p.forge === 'github' && !shown.has(`${p.repoPath}#${p.localId}`))
  const ghByRepo = new Map<string, number[]>()
  for (const p of ghPins) ghByRepo.set(p.repoPath, [...(ghByRepo.get(p.repoPath) ?? []), p.localId])
  const github = await Promise.all([...ghByRepo].map(async ([path, ids]): Promise<RepoView> => {
    const [owner = '', name = ''] = path.split('/')
    return githubPrs($, { owner, name }, undefined, ids)
      .then((mrs): RepoView => ({ root: '', repo: path, branch: '', mrs, forge: 'github' }))
      .catch((err: Error): RepoView => ({ root: '', repo: path, branch: '', mrs: [], error: err.message, forge: 'github' }))
  }))
  if (!token) return github
  const byRepo = new Map<string, number[]>()
  for (const p of pins) if (p.forge !== 'github' && !shown.has(`${repoLabel(p.repoPath)}!${p.localId}`)) byRepo.set(p.repoPath, [...(byRepo.get(p.repoPath) ?? []), p.localId])
  const codeup = await Promise.all([...byRepo].map(async ([path, ids]): Promise<RepoView> => {
    const repo: Repo = { org: path.split('/')[0] ?? '', path }
    const name = repoLabel(path)
    try {
      const { base, list } = await repoMrs($, token, repo)
      const crs = list.filter(cr => ids.includes(cr.localId))
      // A pinned MR has no checkout to read a head from: its last update stands in, so new pushes refetch the stats.
      return { root: '', repo: name, branch: '', mrs: await mrViews($, token, repo, base, crs, cr => cr.updatedAt ?? '') }
    } catch (err) {
      return { root: '', repo: name, branch: '', mrs: [], error: err instanceof Error ? err.message : String(err) }
    }
  }))
  return [...github, ...codeup]
}

/** Git roots of the session's cwd and of every directory it touched, cwd first, deduped. */
async function sessionRoots($: EngineInterface): Promise<string[]> {
  const touched = listOf<string>(await read($, mrDirs))
  const candidates = [await $.session.cwd(), ...[...touched].reverse()]
  const found: string[] = []
  for (const dir of candidates) {
    if (!roots.has(dir)) roots.set(dir, await git($, dir, 'rev-parse', '--show-toplevel'))
    const root = roots.get(dir)
    if (root && !found.includes(root)) found.push(root)
    if (found.length >= LIST_MAX) break
  }
  return found
}

async function repoView($: EngineInterface, token: string | undefined, root: string): Promise<RepoView | null> {
  const [remote, branch, upstream, local] = await Promise.all([
    git($, root, 'remote', 'get-url', 'origin'),
    git($, root, 'branch', '--show-current'),
    git($, root, 'rev-parse', '@{u}'),
    git($, root, 'rev-parse', 'HEAD'),
  ])
  const gh = parseGithubRemote(remote)
  if (gh && branch) {
    const label = `${gh.owner}/${gh.name}`
    return githubPrs($, gh, branch, [])
      .then((mrs): RepoView => ({ root, repo: label, branch, mrs, forge: 'github' }))
      .catch((err: Error): RepoView => ({ root, repo: label, branch, mrs: [], error: err.message, forge: 'github' }))
  }
  if (!token) return null
  const repo = parseRemote(remote)
  if (!repo || !branch) return null
  const name = repoLabel(repo.path)
  return fetchMrs($, token, repo, branch, upstream || local)
    .then(mrs => ({ root, repo: name, branch, mrs }))
    .catch((err: Error) => ({ root, repo: name, branch, mrs: [], error: err.message }))
}

/** How many of `roots` are Codeup checkouts: the ones a missing Yunxiao token leaves out. */
async function codeupRootCount($: EngineInterface, roots: readonly string[]): Promise<number> {
  const remotes = await Promise.all(roots.map(root => git($, root, 'remote', 'get-url', 'origin')))
  return remotes.filter(r => parseRemote(r) !== null).length
}

async function refreshMrs($: EngineInterface, settings: Settings) {
  const found = await sessionRoots($)
  const pins = listOf<MrPin>(await read($, mrPinned))
  if (!found.length && !pins.length) {
    await update($, mrView, () => null)
    return
  }
  // GitHub repos need no Yunxiao token (gh has its own login); Codeup ones are left out without it, and say so.
  const token = await cachedToken($, settings)
  const repos = (await Promise.all(found.map(root => repoView($, token, root)))).filter((r): r is RepoView => r !== null)
  const shown = new Set(repos.flatMap(r => r.mrs.map(mrKey)))
  const pinned = pins.length ? await pinnedViews($, token, pins, shown) : []
  const all = keepLastMrs((await read($, mrView))?.repos ?? [], [...repos, ...pinned])
  const needsToken = !token && (pins.some(p => p.forge !== 'github') || (await codeupRootCount($, found)) > 0)
  await update($, mrView, (): SessionView => (needsToken ? { repos: all, error: NO_TOKEN } : { repos: all }))
}

async function pinMrs($: EngineInterface, settings: Settings, added: readonly MrPin[]) {
  if (!added.length) return
  const known = listOf<MrPin>(await read($, mrPinned))
  const next = addPins(known, added)
  if (next.length === known.length) return
  await update($, mrPinned, () => next)
  await refreshMrs($, settings)
}

/**
 * The MRs a create call just opened: the token owner's newest MRs created since the call started. Read by author and
 * time, not from the call's output, so it works however the call printed (or hid) what it made.
 */
async function pinCreatedMrs($: EngineInterface, settings: Settings, since: number) {
  const token = await cachedToken($, settings)
  const org = token ? await cachedOrg($, token) : undefined
  if (!token || !org) return
  const userId = (await userOf($, token)).id
  if (!userId) return
  const list = await api<ApiChangeRequest[]>($, token, `${org}/changeRequests?authorIds=${userId}&state=all&perPage=${AUTHOR_PAGE}&orderBy=created_at&sort=desc`)
  await pinMrs($, settings, createdSince(list, since - CREATE_SLACK_MS))
}

async function rememberMrDirs($: EngineInterface, tool: string, input: Readonly<Record<string, unknown>>) {
  const added = dirsOf(tool, input, (await $.env.get('HOME')) ?? '')
  if (added.length) await update($, mrDirs, known => rememberDirs(listOf<string>(known), added))
}

// ── Feishu docs ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function rememberDocs($: EngineInterface, found: readonly FoundDoc[], origin: DocOrigin, settings: Settings) {
  if (!found.length || (origin === 'mentioned' && !settings.docsMentioned)) return
  const now = await $.clock.now()
  await update($, docs, list => mergeDocs(listOf<DocLink>(list), found, origin, now))
}

/** The `<title>` of the page an Artifact publish sent, read from its file; undefined when unreadable or untitled. */
async function publishedTitle($: EngineInterface, tool: string, input: Readonly<Record<string, unknown>>): Promise<string | undefined> {
  const path = input.file_path
  if (tool !== 'Artifact' || typeof path !== 'string' || !/\.html?$/i.test(path)) return undefined
  return htmlTitle(await $.fs.read(path).catch(() => ''))
}

/** The Claude Artifacts a call published (created) or worked on (mentioned). */
async function rememberToolArtifacts($: EngineInterface, tool: string, input: Readonly<Record<string, unknown>>, output: string, settings: Settings) {
  if (!settings.docsArtifacts) return
  const { made, mentioned } = artifactsOfCall(tool, { ...input }, output, await publishedTitle($, tool, input))
  await rememberDocs($, mentioned, 'mentioned', settings)
  await rememberDocs($, made, 'created', settings)
}

/** A Lark call's input names the docs it works on (mentions); only a create call's output counts, as what it made. */
async function rememberToolDocs($: EngineInterface, tool: string, input: Readonly<Record<string, unknown>>, output: string, settings: Settings) {
  await rememberToolArtifacts($, tool, input, output, settings)
  if (!isLarkTool(tool, input)) return
  const mentioned = findDocs(JSON.stringify(input))
  const asked = new Set(mentioned.map(d => d.token))
  const made = isCreation(tool, input) ? findDocs(output).filter(d => !asked.has(d.token)) : []
  // Mentions first, so what the call made lands newest: a +copy lists the copy above its source.
  await rememberDocs($, mentioned, 'mentioned', settings)
  await rememberDocs($, made, 'created', settings)
}

/**
 * The document's title through lark-cli. Only a missing program moves on to the next install folder, and only when
 * none of them exists are lookups given up for the session; a timeout or other failure is retried on a later turn.
 */
async function lookupTitle($: EngineInterface, url: string): Promise<Lookup> {
  const candidates = larkCli === undefined ? LARK_CLI : larkCli ? [larkCli] : []
  for (const bin of candidates) {
    const run = await $.process.run(inspectArgv(bin, url), { timeoutMs: LARK_TIMEOUT_MS }).then(
      r => (r.exitCode === NOT_FOUND ? null : r),
      (err: unknown) => (isMissingProgram(err) ? null : { failed: err instanceof Error ? err.message : String(err) }),
    )
    if (run === null) continue
    if (!('failed' in run)) larkCli = bin
    return lookupOf(run)
  }
  if (candidates.length) larkCli = null
  return { final: '未找到 lark-cli' }
}

/** Looks up the titles still missing, a few per turn; a document is retried a few times, then given up. */
async function lookupTitles($: EngineInterface) {
  const pending = listOf<DocLink>(await read($, docs))
    .filter(d => !d.title && !d.isLookedUp && (d.lookupTries ?? 0) < MAX_LOOKUP_TRIES && !lookingUp.has(d.token))
    .slice(0, LOOKUPS_PER_TURN)
  if (!pending.length) return
  pending.forEach(d => lookingUp.add(d.token))
  const results = new Map(await Promise.all(pending.map(async d => [d.token, await lookupTitle($, d.url)] as const)))
  pending.forEach(d => lookingUp.delete(d.token))
  results.forEach((r, token) => {
    if ('retry' in r) $.ui.log(`${PLUGIN} docs: 标题查询失败（将重试）${token.slice(0, 8)}…: ${r.retry}`)
  })
  await update($, docs, list => listOf<DocLink>(list).map(d => {
    const r = results.get(d.token)
    if (!r) return d
    if ('title' in r) return { ...d, title: r.title, isLookedUp: true }
    if ('final' in r) return { ...d, isLookedUp: true }
    return { ...d, lookupTries: (d.lookupTries ?? 0) + 1 }
  }))
}

// ── Yunxiao deploys ─────────────────────────────────────────────────────────────────────────────────────────────

async function userOf($: EngineInterface, token: string): Promise<{ id?: string; lastOrganization?: string }> {
  platformUser ??= await getJson<{ id?: string; lastOrganization?: string }>($, token, PLATFORM_USER, 'Yunxiao')
  return platformUser
}

async function cachedOrg($: EngineInterface, token: string): Promise<string | undefined> {
  orgCache ??= await resolveOrg($, token)
  return orgCache
}

/**
 * The Yunxiao organization: $ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID, its export line in a shell profile, the org of any
 * Codeup repo the session works in, else the org the token's owner last used (a session outside any repo).
 */
async function resolveOrg($: EngineInterface, token: string): Promise<string | undefined> {
  const fromEnv = await $.env.get('ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID')
  if (fromEnv) return fromEnv
  const home = await $.env.get('HOME')
  for (const name of PROFILES) {
    const org = exportFromProfile(await $.fs.read(`${home}/${name}`).catch(() => ''), ORG_VAR)
    if (org) return org
  }
  for (const root of await sessionRoots($)) {
    const org = parseRemote(await git($, root, 'remote', 'get-url', 'origin'))?.org
    if (org) return org
  }
  return (await userOf($, token).catch(() => undefined))?.lastOrganization || undefined
}

/** What the Flow pipeline's name says about an unnamed run: its app, stage and env. */
async function pipelineOf($: EngineInterface, token: string, org: string, r: DeployRun): Promise<Partial<DeployRun>> {
  const id = r.flowPipelineId
  if (!id || !isUnnamed(r)) return {}
  if (!pipelineNames.has(id)) {
    const { name } = await getJson<{ name?: unknown }>($, token, `${FLOW_BASE}/${org}/pipelines/${id}`, 'Flow')
    if (typeof name === 'string' && name) pipelineNames.set(id, name)
  }
  const name = pipelineNames.get(id)
  if (!name) return {}
  const label = pipelineLabel(name)
  return { app: label.app, ...(r.stageName || !label.stageName ? {} : { stageName: label.stageName }), ...(r.env || !label.env ? {} : { env: label.env }) }
}

/** The AppStack release stage a Flow-only run belongs to, so its row links the stage page rather than the Flow run. */
async function appStageOf($: EngineInterface, token: string, org: string, app: string, r: DeployRun): Promise<Partial<DeployRun>> {
  const id = r.flowPipelineId
  if (r.stageSn || !id || isUnnamed({ app, flowPipelineId: id })) return {}
  if (!appWorkflows.has(app)) appWorkflows.set(app, await getJson<unknown>($, token, `${APPSTACK_BASE}/${org}/apps/${encodeURIComponent(app)}/releaseWorkflows`, 'AppStack'))
  const stage = stageOfPipeline(appWorkflows.get(app), id)
  if (!stage) return {}
  return { workflowSn: stage.workflowSn, stageSn: stage.stageSn, url: stageUrl(app, stage.workflowSn, stage.stageSn), ...(r.stageName || !stage.stageName ? {} : { stageName: stage.stageName }) }
}

/** The stage's name and env, for a run whose trigger did not print them (a tracked link, a direct API call). */
async function stageOf($: EngineInterface, token: string, org: string, r: DeployRun): Promise<Partial<DeployRun>> {
  if (r.stageName || !r.stageSn) return {}
  const key = `${r.app}/${r.workflowSn}`
  if (!stageNames.has(key)) {
    const briefs = await getJson<{ sn?: unknown; name?: unknown }[]>($, token, `${APPSTACK_BASE}/${org}/apps/${encodeURIComponent(r.app)}/releaseWorkflow/${r.workflowSn}/releaseStageBriefs`, 'AppStack')
    stageNames.set(key, new Map((Array.isArray(briefs) ? briefs : []).flatMap(b => (typeof b.sn === 'string' && typeof b.name === 'string' ? [[b.sn, b.name] as const] : []))))
  }
  const name = stageNames.get(key)?.get(r.stageSn)
  return name ? { stageName: name, ...(r.env ? {} : { env: envOfStage(name) }) } : {}
}

/**
 * The run's stages' jobs as Yunxiao has them now. A run whose Flow run is known is read from it directly; otherwise its
 * stage execution is found once (the latest that started after the trigger) and pinned.
 */
async function fetchRun($: EngineInterface, token: string, org: string, r: DeployRun): Promise<Partial<DeployRun>> {
  if (r.flowPipelineId && r.flowRunId) {
    const named = await pipelineOf($, token, org, r).catch((): Partial<DeployRun> => ({}))
    const appStage = await appStageOf($, token, org, named.app ?? r.app, r).catch(() => ({}))
    const stage = { ...(await stageOf($, token, org, r).catch(() => ({}))), ...named, ...appStage }
    const flowRun = await getJson<ApiPipelineRun['pipelineRun']>($, token, `${FLOW_BASE}/${org}/pipelines/${r.flowPipelineId}/runs/${r.flowRunId}`, 'Flow')
    const { branch, ...run } = runOf({ pipelineRun: flowRun })
    return { ...stage, number: r.flowRunId, ...run, ...(r.branch || !branch ? {} : { branch }) }
  }
  const base = `${APPSTACK_BASE}/${org}/apps/${encodeURIComponent(r.app)}/releaseWorkflows/${r.workflowSn}/releaseStages/${r.stageSn}/executions`
  const stage = await stageOf($, token, org, r).catch(() => ({}))
  const latest = r.number === undefined ? (await getJson<{ data?: { number?: unknown; startTime?: unknown }[] }>($, token, `${base}?perPage=1&page=1`, 'AppStack')).data?.[0] : undefined
  const number = r.number ?? pickExecution(latest, r.isTracked ? 0 : r.triggeredAt)
  if (number === undefined) return stage
  const { branch, ...run } = runOf(await getJson<ApiPipelineRun>($, token, `${base}/${number}:getPipelineRun`, 'AppStack'))
  return { ...stage, number, ...run, ...(r.branch || !branch ? {} : { branch }) }
}

/** Refreshes `key`'s run, or every run still going; a failure is kept on its run and shown in its row. */
async function refreshDeploys($: EngineInterface, settings: Settings, key?: string) {
  const due = listOf<DeployRun>(await read($, deploys)).filter(r => (key ? r.key === key : !isSettled(r)) && !deployFetching.has(r.key))
  if (!due.length) return
  const token = await cachedToken($, settings)
  const org = token ? await cachedOrg($, token) : undefined
  due.forEach(r => deployFetching.add(r.key))
  const patches = await Promise.all(due.map(async r => {
    if (!token || !org) return [r.key, { error: token ? NO_ORG : NO_TOKEN }] as const
    const patch = await fetchRun($, token, org, r).then(
      (p): Partial<DeployRun> => ({ ...p, error: undefined }),
      (err: Error): Partial<DeployRun> => ({ error: err.message }),
    )
    return [r.key, patch] as const
  }))
  due.forEach(r => deployFetching.delete(r.key))
  const byKey = new Map(patches)
  await update($, deploys, list => listOf<DeployRun>(list).map(r => {
    const patch = byKey.get(r.key)
    if (!patch) return r
    const { error, ...rest } = { ...r, ...patch }
    return error ? { ...rest, error } : rest
  }))
}

async function rememberDeploy($: EngineInterface, tool: string, input: Readonly<Record<string, unknown>>, output: string, isError: boolean, settings: Settings) {
  const triggered = triggersOf(tool, input, output, isError)
  if (!triggered.length) return
  const now = await $.clock.now()
  await update($, deploys, list => triggered.reduceRight((runs, t) => addRun(runs, t, now), listOf<DeployRun>(list)))
  for (const t of triggered) $.clock.after(DEPLOY_FIRST_CHECK_MS, () => void guard($, 'deploy', () => refreshDeploys($, settings, t.key)))
}

/** Tracks the AppStack stages linked in `text` without deploying anything: each shows its latest run. */
async function trackDeploys($: EngineInterface, text: string, settings: Settings): Promise<number> {
  const targets = findStageTargets(text)
  if (!targets.length) return 0
  const now = await $.clock.now()
  await update($, deploys, list => targets.reduce((runs, t) => addRun(runs, t, now, true), listOf<DeployRun>(list)))
  await Promise.all(targets.map(t => refreshDeploys($, settings, t.key)))
  return targets.length
}

// ── /hud ────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function runHud($: EngineInterface, args: string, settings: Settings): Promise<string> {
  const cmd = parseHud(args)
  if (cmd.kind === 'reply') return cmd.text
  if (cmd.kind === 'status') return status(settings, (await read($, collapsed)) ?? settings.collapsed)
  if (cmd.kind === 'fold') {
    await update($, collapsed, () => cmd.isCollapsed)
    return cmd.isCollapsed ? '已折叠' : '已展开'
  }
  const { deny } = await $.config.set({ key: `${PLUGIN}.${cmd.key}`, value: cmd.value })
  return deny ? `未能修改 ${cmd.key}：${deny}` : `已设置 ${cmd.key} = ${String(cmd.value)}`
}

// ── persistence ─────────────────────────────────────────────────────────────────────────────────────────────────

/** How often the session's snapshot is compared and, when it changed, written. */
const SAVE_EVERY_MS = 30_000
/** The last snapshot written, so an unchanged one is not written again. */
let lastSaved = ''

async function savedOf($: EngineInterface): Promise<Saved> {
  return {
    mrDirs: listOf<string>(await read($, mrDirs)),
    mrPinned: listOf<MrPin>(await read($, mrPinned)),
    mrDismissed: listOf<string>(await read($, mrDismissed)),
    docs: listOf<DocLink>(await read($, docs)),
    docsDismissed: listOf<string>(await read($, docsDismissed)),
    deploys: listOf<DeployRun>(await read($, deploys)),
    deployDismissed: listOf<string>(await read($, deployDismissed)),
    collapsed: (await read($, collapsed)) ?? null,
  }
}

/** Where the desktop app keeps a JSON file per session, `isArchived` and `cliSessionId` among its fields. */
const DESKTOP_SESSIONS = 'Library/Application Support/Claude/claude-code-sessions'
/** Prints the `cliSessionId` line of each archived session's file; nothing where the app is not installed. */
const ARCHIVED_SCRIPT = `grep -rl --include='local_*.json' '"isArchived":true' "$1" 2>/dev/null | while IFS= read -r f; do grep -o '"cliSessionId":"[^"]*"' "$f"; done; exit 0`
const ARCHIVED_TIMEOUT_MS = 10_000

/**
 * The sessions archived in the desktop app. The app tells a plugin nothing when a session is archived (its process just
 * ends), so its own session files are read. ponytail: reads the app's internal metadata; if its layout changes this
 * finds nothing and the 30-session / 30-day cap still bounds the store.
 */
async function archivedSessions($: EngineInterface): Promise<Set<string>> {
  const home = await $.env.get('HOME')
  if (!home) return new Set()
  const run = await $.process.run(['/bin/sh', '-c', ARCHIVED_SCRIPT, 'sh', `${home}/${DESKTOP_SESSIONS}`], { timeoutMs: ARCHIVED_TIMEOUT_MS })
  return archivedIdsOf(run.stdout)
}

/** Drops archived sessions' snapshots and those past the newest kept or a month old; `isFull` keeps fewer, to make room. */
async function pruneStore($: EngineInterface, isFull = false) {
  const keys = (await $.store.keys()).filter(k => k.startsWith(SNAPSHOT_PREFIX))
  if (!keys.length) return
  const saved = await Promise.all(keys.map(async key => ({ key, savedAt: snapshotOf(await $.store.get(key))?.savedAt ?? 0 })))
  const archived = await archivedSessions($).catch(() => new Set<string>())
  for (const key of staleKeys(saved, await $.clock.now(), isFull, archived)) await $.store.delete(key)
}

/** Writes the session's snapshot when it changed since the last write; a full store is pruned harder once. */
async function saveSession($: EngineInterface) {
  const state = await savedOf($)
  const text = JSON.stringify(state)
  if (text === lastSaved || (isEmpty(state) && !lastSaved)) return
  const key = `${SNAPSHOT_PREFIX}${await $.session.id()}`
  const snapshot = { savedAt: await $.clock.now(), state }
  await $.store.set(key, snapshot).catch(async () => {
    await pruneStore($, true)
    await $.store.set(key, snapshot)
  })
  lastSaved = text
}

/**
 * Puts the session's snapshot back when the host holds nothing for it: a fresh process resuming the session. A hot
 * reload finds the host's values and keeps them.
 */
async function restoreSession($: EngineInterface) {
  const now = await savedOf($)
  if (!isEmpty(now)) {
    lastSaved = JSON.stringify(now)
    return
  }
  const snap = snapshotOf(await $.store.get(`${SNAPSHOT_PREFIX}${await $.session.id()}`))
  if (!snap) return
  const s = snap.state
  await update($, mrDirs, () => s.mrDirs)
  await update($, mrPinned, () => s.mrPinned)
  await update($, mrDismissed, () => s.mrDismissed)
  await update($, docs, () => s.docs)
  await update($, docsDismissed, () => s.docsDismissed)
  await update($, deploys, () => s.deploys)
  await update($, deployDismissed, () => s.deployDismissed)
  await update($, collapsed, () => s.collapsed)
  lastSaved = JSON.stringify(s)
}

// ── wiring ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const settings = settingsOf(options)
  const isAnyOn = MODULE_IDS.some(id => settings[id])

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Before any refresh: the pins, dirs and runs it reads may come back from the store.
    if (isAnyOn) {
      await guard($, 'persist', () => restoreSession($))
      void guard($, 'persist', () => pruneStore($))
      $.clock.every(SAVE_EVERY_MS, () => void guard($, 'persist', () => saveSession($)))
    }
    await $.command.register({ name: 'hud', description: 'session-hud：查看 / 启停模块、折叠、修改配置', argumentHint: '[usage|mr|docs|deploy on|off | fold | unfold | set <key> <value>]' })
    if (settings.mr) await $.command.register({ name: 'mr', description: '列出本会话涉及仓库的 Codeup MR 及链接' })
    if (settings.docs) await $.command.register({ name: 'docs', description: '列出本会话创建或提到的飞书文档及链接' })
    if (settings.deploy) await $.command.register({ name: 'deploys', description: '列出本会话的云效发布；带 AppStack 阶段链接则跟踪该阶段', argumentHint: '[AppStack 阶段链接]' })
    if (settings.usage) await guard($, 'usage', () => refreshUsage($))
    if (settings.mr) {
      void guard($, 'mr', () => refreshMrs($, settings))
      $.clock.every(settings.mrPollSeconds * 1_000, () => void guard($, 'mr', () => refreshMrs($, settings)))
    }
    if (settings.deploy) {
      // Only runs still going are fetched; with none, a tick reads the state and stops.
      void guard($, 'deploy', () => refreshDeploys($, settings))
      $.clock.every(settings.deployPollSeconds * 1_000, () => void guard($, 'deploy', () => refreshDeploys($, settings)))
    }
    return result
  })

  // Pushed with every measurement: no polling, no extra tokens.
  on('session.measure', async ($, e, next) => {
    if (settings.usage) await guard($, 'usage', () => refreshUsage($))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (settings.docs) await guard($, 'docs', () => rememberDocs($, findAllDocs(e.text, settings.docsArtifacts), 'mentioned', settings))
    if (settings.deploy) await guard($, 'deploy', () => trackDeploys($, e.text, settings))
    if (settings.mr) await guard($, 'mr', () => pinMrs($, settings, [...findMrLinks(e.text), ...findPrLinks(e.text)]))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const { tool, ...input } = e
    // An MR-opening call is timed from before it runs: what it opened is then found by author and creation time.
    const mrCreateStart = settings.mr && isMrCreation(tool, input as { command?: unknown }) ? await $.clock.now() : undefined
    const ran = await next(e)
    // A failed call's error text is no output: nothing it names was made.
    const output = !ran.isError && 'text' in ran && typeof ran.text === 'string' ? ran.text : ''
    if (settings.mr) {
      await guard($, 'mr', () => rememberMrDirs($, tool, input))
      const said = `${JSON.stringify(input)}\n${output}`
      await guard($, 'mr', () => pinMrs($, settings, [...findMrLinks(said), ...findPrLinks(said)]))
      if (mrCreateStart !== undefined && !ran.isError) await guard($, 'mr', () => pinCreatedMrs($, settings, mrCreateStart))
    }
    if (settings.docs) await guard($, 'docs', () => rememberToolDocs($, tool, input, output, settings))
    if (settings.deploy) await guard($, 'deploy', () => rememberDeploy($, tool, input, 'text' in ran && typeof ran.text === 'string' ? ran.text : '', Boolean(ran.isError), settings))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A subagent's turn ends inside the main one: its answer reaches the main answer, and the refreshes wait for it.
    if (e.agentId) return result
    const answer = 'answer' in e && typeof e.answer === 'string' ? e.answer : ''
    await Promise.all([
      settings.mr && guard($, 'mr', async () => {
        await pinMrs($, settings, [...findMrLinks(answer), ...findPrLinks(answer)])
        await refreshMrs($, settings)
      }),
      settings.docs && guard($, 'docs', () => rememberDocs($, findAllDocs(answer, settings.docsArtifacts), 'mentioned', settings)),
    ])
    // Title lookups run lark-cli (seconds each): off the turn's path, on a timer.
    if (settings.docs) $.clock.after(0, () => void guard($, 'docs', () => lookupTitles($)))
    if (isAnyOn) await guard($, 'persist', () => saveSession($))
    return result
  })

  on('session.end', async ($, e, next) => {
    if (isAnyOn) await guard($, 'persist', () => saveSession($))
    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => ({ text: await runHud($, e.args, settings) }))

  on('command.run', { command: 'mr' }, async $ => {
    if (!settings.mr) return { text: 'Codeup MR 模块已关闭：/hud mr on' }
    await refreshMrs($, settings)
    const v = await read($, mrView)
    return { text: v?.error ?? mrList(v?.repos ?? [], state => stateOf(state).label) }
  })

  on('command.run', { command: 'deploys' }, async ($, e) => {
    if (!settings.deploy) return { text: '云效发布模块已关闭：/hud deploy on' }
    // `/deploys <stage link>…` tracks those stages; bare `/deploys` refreshes and lists.
    if (!(await trackDeploys($, e.args, settings))) await refreshDeploys($, settings)
    return { text: deployList(listOf<DeployRun>(await read($, deploys))) }
  })

  on('command.run', { command: 'docs' }, async $ => ({
    text: settings.docs ? (await guard($, 'docs', () => lookupTitles($)), docList(listOf<DocLink>(await read($, docs)))) : '飞书文档模块已关闭：/hud docs on',
  }))

  // The band above the prompt is one site shared by every plugin: draw on top of whatever the plugins beneath drew
  // (next), never instead of it, and step aside entirely while a survey holds it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isAnyOn) return next(e)
    // A card (a survey, a question) holds the band: stay as one line above it, with nothing in it to press.
    const isCardUp = e.props.hasSurvey
    const ui = $.ui.resolve(e)
    const unfolded = listOf<string>(await read($, expandedLists))
    const foldOf = (list: string): Fold => ({
      isExpanded: unfolded.includes(list),
      toggle: () => void update($, expandedLists, cur => {
        const known = listOf<string>(cur)
        return known.includes(list) ? known.filter(l => l !== list) : [...known, list]
      }),
    })
    const drawn: (Section | null)[] = []
    if (settings.usage) drawn.push(usageSection(ui, await read($, usage), await $.clock.now(), settings))
    if (settings.mr) {
      const mrState = { view: await read($, mrView), dismissed: listOf<string>(await read($, mrDismissed)), expanded: await read($, mrExpanded) }
      drawn.push(mrSection(ui, mrState, mrLayout(settings, e.props.bodyColumns), {
        // Unfolding the checks also fetches them afresh: merge state, branch, conflicts as Codeup has them now.
        toggleChecks: key => {
          void update($, mrExpanded, cur => (cur === key ? null : key))
          void guard($, 'mr', () => refreshMrs($, settings))
        },
        dismiss: key => void update($, mrDismissed, list => [...listOf<string>(list), key]),
      }, foldOf('mr')))
    }
    if (settings.docs) {
      const shown = visibleDocs(listOf<DocLink>(await read($, docs)), listOf<string>(await read($, docsDismissed)), settings)
      drawn.push(docsSection(ui, shown, docsLayout(settings, e.props.bodyColumns), token => void update($, docsDismissed, list => [...listOf<string>(list), token]), foldOf('docs')))
    }
    if (settings.deploy) {
      const deployState = { runs: listOf<DeployRun>(await read($, deploys)), dismissed: listOf<string>(await read($, deployDismissed)), expanded: await read($, deployExpanded) }
      drawn.push(deploySection(ui, deployState, mrLayout(settings, e.props.bodyColumns), {
        // Unfolding a run's stages also fetches them afresh, finished or not.
        toggle: key => {
          void update($, deployExpanded, cur => (cur === key ? null : key))
          void guard($, 'deploy', () => refreshDeploys($, settings, key))
        },
        dismiss: key => void update($, deployDismissed, list => [...listOf<string>(list), key]),
      }, foldOf('deploy')))
    }
    const sections = drawn.filter((s): s is Section => s !== null)
    if (!sections.length) return next(e)

    const isCollapsed = (await read($, collapsed)) ?? settings.collapsed
    const below = await next(e)
    const mine = isCardUp
      ? band(ui, sections, true)
      : band(ui, sections, isCollapsed, () => void update($, collapsed, cur => !(cur ?? settings.collapsed)))
    if (isBlank(below)) return mine
    return (
      <ui.Box flexDirection="column">
        {mine}
        {below}
      </ui.Box>
    )
  })
}
