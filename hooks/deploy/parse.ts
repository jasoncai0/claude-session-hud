import type { DeployRun, DeployStage } from '../../types'

const STAGE_URL_RE = /https:\/\/devops\.aliyun\.com\/appstack\/app\/([\w.-]+)\/workflow\/([0-9a-f]{32})\/stage\/([0-9a-f]{32})/
const STAGE_URLS_RE = new RegExp(STAGE_URL_RE.source, 'g')
const DEPLOY_SH_RE = /\bdeploy\.sh\s+([\w.-]+)\s+([\w.-]+)/
const EXECUTE_RE = /\bapp-stack-execute-change-request-release-stage\b/
/** Runs kept per session; the oldest drop off. */
const MAX_RUNS = 10
/** How much earlier than the trigger an execution may start and still be its run (clock skew). */
const START_SLACK_MS = 2 * 60_000

/** What a trigger names: the stage, and what deploy.sh printed about it. */
export type DeployTarget = Omit<DeployRun, 'triggeredAt' | 'number' | 'status' | 'stages' | 'error'>

const flagOf = (cmd: string, flag: string): string | undefined => cmd.match(new RegExp(`--${flag}[=\\s]+['"]?([\\w.-]+)`))?.[1]
const lineOf = (out: string, label: string): string | undefined => out.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, 'm'))?.[1]

const target = (app: string, workflowSn: string, stageSn: string, extra: Partial<DeployTarget>): DeployTarget => ({
  key: `${app}/${stageSn}`,
  app,
  workflowSn,
  stageSn,
  url: `https://devops.aliyun.com/appstack/app/${app}/workflow/${workflowSn}/stage/${stageSn}/current`,
  ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)),
})

/**
 * The AppStack release stage a finished Bash call triggered, or null: a yunxiao-deploy `deploy.sh` run that printed
 * `Triggered.` and the stage page, or a direct `app-stack-execute-change-request-release-stage` call that did not fail.
 * A dry run prints no `Triggered.`, so it never counts.
 */
export function triggerOf(tool: string, input: { command?: unknown }, output: string, isError: boolean): DeployTarget | null {
  const cmd = typeof input.command === 'string' ? input.command : ''
  if (tool !== 'Bash' || isError || !cmd) return null
  const deploySh = cmd.match(DEPLOY_SH_RE)
  if (deploySh && /\bTriggered\b/.test(output)) {
    const url = output.match(STAGE_URL_RE)
    if (!url?.[1] || !url[2] || !url[3]) return null
    const envLine = lineOf(output, 'Env') ?? ''
    const branch = lineOf(output, 'Branch')
    return target(url[1], url[2], url[3], {
      env: envLine.split(/\s+/)[0] || deploySh[2],
      stageName: envLine.match(/\(stage:\s*([^/)]+?)\s*(?:\/|\))/)?.[1],
      branch: branch && !branch.startsWith('<') ? branch : undefined,
      feature: lineOf(output, 'Labelled') ?? lineOf(output, 'Feature')?.replace(/^<none.*$/, ''),
    })
  }
  if (!EXECUTE_RE.test(cmd) || /--cli-dry-run\b/.test(cmd)) return null
  const app = flagOf(cmd, 'app-name')
  const wf = flagOf(cmd, 'release-workflow-sn')
  const stage = flagOf(cmd, 'release-stage-sn')
  return app && wf && stage ? target(app, wf, stage, {}) : null
}

/** Every AppStack stage page linked in `text`, deduped: what a pasted link asks to track. */
export function findStageTargets(text: string): DeployTarget[] {
  const found = new Map<string, DeployTarget>()
  for (const [, app, wf, stage] of text.matchAll(STAGE_URLS_RE)) {
    if (app && wf && stage && !found.has(`${app}/${stage}`)) found.set(`${app}/${stage}`, target(app, wf, stage, {}))
  }
  return [...found.values()]
}

/** Adds a run, newest first; triggering (or tracking) a stage again starts its entry over. */
export function addRun(known: readonly DeployRun[], t: DeployTarget, now: number, isTracked = false): DeployRun[] {
  const run: DeployRun = isTracked ? { ...t, triggeredAt: now, isTracked } : { ...t, triggeredAt: now }
  return [run, ...known.filter(r => r.key !== t.key)].slice(0, MAX_RUNS)
}

const ENV_KEYWORDS: readonly (readonly [string, RegExp])[] = [['prod', /生产|线上|正式|prod/i], ['pre', /预发|灰度|staging|pre/i], ['test', /测试|日常|daily|test/i]]

/** A release stage's name as the env it deploys to: 生产阶段 → prod, 预发阶段 → pre; else the name without 阶段. */
export function envOfStage(name: string): string {
  return ENV_KEYWORDS.find(([, re]) => re.test(name))?.[0] ?? name.replace(/阶段$/, '')
}

const TERMINAL = new Set(['SUCCESS', 'FAIL', 'FAILED', 'CANCELED', 'CANCELLED'])

/** Finished runs are not polled; an unpinned run (its execution not found yet) still is. */
export const isSettled = (r: DeployRun) => r.number !== undefined && r.status !== undefined && TERMINAL.has(r.status)

/** The stage execution that is this run: the latest one, unless it started before the trigger (0: any). */
export function pickExecution(latest: { number?: unknown; startTime?: unknown } | undefined, triggeredAt: number): string | undefined {
  if (!latest || (typeof latest.number !== 'string' && typeof latest.number !== 'number')) return undefined
  const started = typeof latest.startTime === 'string' ? Date.parse(latest.startTime) : NaN
  return Number.isNaN(started) || started >= triggeredAt - START_SLACK_MS ? String(latest.number) : undefined
}

type ApiJob = { name?: unknown; status?: unknown }
type ApiStage = { name?: unknown; stageInfo?: { name?: unknown; status?: unknown; jobs?: ApiJob[] } }
export type ApiPipelineRun = { pipelineRun?: { status?: unknown; stages?: ApiStage[]; sources?: { data?: { branch?: unknown } }[] } }

const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)

/** A getPipelineRun answer as the run's status, its stages' jobs and the branch it built. */
export function runOf(api: ApiPipelineRun): { status: string; stages: DeployStage[]; branch?: string } {
  const run = api.pipelineRun ?? {}
  const stages = (run.stages ?? []).map((s): DeployStage => ({
    name: str(s.name ?? s.stageInfo?.name, '阶段'),
    status: str(s.stageInfo?.status, 'INIT'),
    jobs: (s.stageInfo?.jobs ?? []).map(j => ({ name: str(j.name, '任务'), status: str(j.status, 'INIT') })),
  }))
  const branch = run.sources?.[0]?.data?.branch
  return { status: str(run.status, 'RUNNING'), stages, ...(typeof branch === 'string' && branch ? { branch } : {}) }
}

export type Tone = 'success' | 'error' | 'warning' | 'inactive' | 'suggestion'

const STATES: Record<string, { label: string; glyph: string; tone: Tone }> = {
  SUCCESS: { label: '成功', glyph: '✓', tone: 'success' },
  FAIL: { label: '失败', glyph: '✕', tone: 'error' },
  FAILED: { label: '失败', glyph: '✕', tone: 'error' },
  RUNNING: { label: '运行中', glyph: '◐', tone: 'suggestion' },
  WAITING: { label: '待确认', glyph: '◷', tone: 'warning' },
  SWITCH_MANUAL: { label: '待确认', glyph: '◷', tone: 'warning' },
  CANCELED: { label: '已取消', glyph: '⊘', tone: 'inactive' },
  CANCELLED: { label: '已取消', glyph: '⊘', tone: 'inactive' },
  SKIPPED: { label: '已跳过', glyph: '–', tone: 'inactive' },
  INIT: { label: '未开始', glyph: '○', tone: 'inactive' },
  QUEUED: { label: '排队中', glyph: '○', tone: 'inactive' },
}

export function stateOf(status: string | undefined): { label: string; glyph: string; tone: Tone } {
  if (status === undefined) return { label: '查询中', glyph: '…', tone: 'inactive' }
  return STATES[status] ?? { label: status, glyph: '?', tone: 'inactive' }
}

/**
 * Where the run stands, as one line: the job it stopped at or is on (the first that is not done), else the last job.
 * `✕ 灰度人工卡点`, `◐ 预热发布`, `✓ 全量发布`.
 */
export function progressOf(r: DeployRun): string {
  if (r.error) return `查询失败：${r.error}`
  const jobs = (r.stages ?? []).flatMap(s => s.jobs)
  if (!jobs.length) return r.number ? `#${r.number}` : '等待运行开始'
  const current = jobs.find(j => j.status !== 'SUCCESS' && j.status !== 'SKIPPED') ?? jobs[jobs.length - 1]
  const done = jobs.filter(j => j.status === 'SUCCESS').length
  return current ? `${stateOf(current.status).glyph} ${current.name} (${done}/${jobs.length})` : ''
}
