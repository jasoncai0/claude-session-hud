import type { DeployRun, DeployStage } from '../../types'

const STAGE_URL_RE = /https:\/\/devops\.aliyun\.com\/appstack\/app\/([\w.-]+)\/workflow\/([0-9a-f]{32})\/stage\/([0-9a-f]{32})/
const STAGE_URLS_RE = new RegExp(STAGE_URL_RE.source, 'g')
/** One `deploy.sh <service> <env> [branch]` call; the words may be quoted or shell variables. */
const DEPLOY_SH_RE = /\bdeploy\.sh\s+(\S+)\s+(\S+)(?:\s+([^\s-]\S*))?/g
const FLOW_RUN_RE = /https:\/\/flow\.aliyun\.com\/pipelines\/(\d+)\/builds\/(\d+)/g
const DRY_RUN_RE = /\s--(?:dry-run|cli-dry-run)\b/
const EXECUTE_RE = /\bapp-stack-execute-change-request-release-stage\b/
/** Runs kept per session; the oldest drop off. */
const MAX_RUNS = 30
/** An AppStack-made Flow pipeline's name: `<app>-<workflow>-<stage>`, e.g. `demo-api-标准发布流程-生产阶段`. */
const PIPELINE_NAME_RE = /^(.+)-([^-]+)-([^-]+阶段[^-]*)$/
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

/** A word of the command as written: quotes dropped; a shell variable or substitution is not a value. */
const literal = (word: string | undefined): string | undefined => {
  const w = word?.replace(/^(['"])(.*)\1$/, '$2')
  return w && !/[$`(){}]/.test(w) ? w : undefined
}

/** A Flow run page: what a release is when deploy.sh's output was cut down to its `Flow run:` line. */
const unnamed = (pipelineId: string): string => `流水线 ${pipelineId}`

/** A Flow-only run whose call named no app (a loop over `$app`): its row is named from the pipeline once read. */
export const isUnnamed = (r: Pick<DeployRun, 'app' | 'flowPipelineId'>): boolean => Boolean(r.flowPipelineId) && r.app === unnamed(r.flowPipelineId ?? '')

/** What a Flow pipeline's name says about its run: the app, and the stage and env when AppStack named it. */
export function pipelineLabel(name: string): Pick<DeployRun, 'app' | 'stageName' | 'env'> {
  const m = name.match(PIPELINE_NAME_RE)
  return m?.[1] && m[3] ? { app: m[1], stageName: m[3], env: envOfStage(m[3]) } : { app: name }
}

const flowTarget = (pipelineId: string, runId: string, extra: Partial<DeployTarget>): DeployTarget => ({
  key: `flow/${pipelineId}`,
  app: extra.app ?? unnamed(pipelineId),
  workflowSn: '',
  stageSn: '',
  url: `https://flow.aliyun.com/pipelines/${pipelineId}/builds/${runId}`,
  ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)),
  flowPipelineId: pipelineId,
  flowRunId: runId,
})

/**
 * Every AppStack release a finished Bash call triggered, in the order it ran them. A command may run deploy.sh several
 * times (a loop, one call per region) and cut its output down (`| grep "Flow run"`): the n-th `deploy.sh` call is
 * paired with the n-th stage page and the n-th `Flow run:` link in the output, and either link is enough. The env and
 * branch come from the call's words, or from its `Env:` / `Branch:` lines when it ran alone. A dry run (which still
 * prints links to existing runs) and a failed call never count. A direct
 * `app-stack-execute-change-request-release-stage` call counts by its flags.
 */
export function triggersOf(tool: string, input: { command?: unknown }, output: string, isError: boolean): DeployTarget[] {
  const cmd = typeof input.command === 'string' ? input.command : ''
  if (tool !== 'Bash' || isError || !cmd || DRY_RUN_RE.test(cmd)) return []
  const calls = [...cmd.matchAll(DEPLOY_SH_RE)]
  if (calls.length) {
    const stages = [...output.matchAll(STAGE_URLS_RE)]
    const flows = [...output.matchAll(FLOW_RUN_RE)]
    // A loop runs one call many times: then the links, not the calls, say how many releases there were.
    const count = Math.max(stages.length, flows.length)
    const isSingle = count === 1
    return Array.from({ length: count }, (_, i) => {
      // Past the last call, a loop is running it again: its literal words hold for every run, its variables for none.
      const call = calls[Math.min(i, calls.length - 1)]
      const envLine = isSingle ? lineOf(output, 'Env') ?? '' : ''
      const branchLine = isSingle ? lineOf(output, 'Branch') : undefined
      const extra: Partial<DeployTarget> = {
        env: envLine.split(/\s+/)[0] || literal(call?.[2]),
        stageName: envLine.match(/\(stage:\s*([^/)]+?)\s*(?:\/|\))/)?.[1],
        branch: (branchLine && !branchLine.startsWith('<') ? branchLine : undefined) ?? literal(call?.[3]),
        feature: isSingle ? lineOf(output, 'Labelled') ?? lineOf(output, 'Feature')?.replace(/^<none.*$/, '') : undefined,
      }
      const stage = stages[i]
      const flow = flows[i]
      const flowIds = flow?.[1] && flow[2] ? { flowPipelineId: flow[1], flowRunId: flow[2] } : {}
      if (stage?.[1] && stage[2] && stage[3]) return { ...target(stage[1], stage[2], stage[3], extra), ...flowIds }
      return flow?.[1] && flow[2] ? flowTarget(flow[1], flow[2], { ...extra, app: literal(call?.[1]) }) : null
    }).filter((t): t is DeployTarget => t !== null)
  }
  if (!EXECUTE_RE.test(cmd)) return []
  const app = flagOf(cmd, 'app-name')
  const wf = flagOf(cmd, 'release-workflow-sn')
  const stage = flagOf(cmd, 'release-stage-sn')
  return app && wf && stage ? [target(app, wf, stage, {})] : []
}

/** Every AppStack stage page linked in `text`, deduped: what a pasted link asks to track. */
export function findStageTargets(text: string): DeployTarget[] {
  const found = new Map<string, DeployTarget>()
  for (const [, app, wf, stage] of text.matchAll(STAGE_URLS_RE)) {
    if (app && wf && stage && !found.has(`${app}/${stage}`)) found.set(`${app}/${stage}`, target(app, wf, stage, {}))
  }
  return [...found.values()]
}

/**
 * Adds a run, newest first; triggering (or tracking) a stage again starts its entry over. The same Flow pipeline is the
 * same stage however it was recorded (stage page or `Flow run:` link), and an unnamed one keeps the name it had.
 */
export function addRun(known: readonly DeployRun[], t: DeployTarget, now: number, isTracked = false): DeployRun[] {
  const isSame = (r: DeployRun) => r.key === t.key || (t.flowPipelineId !== undefined && r.flowPipelineId === t.flowPipelineId)
  const prior = known.find(r => isSame(r) && !isUnnamed(r))
  const named = isUnnamed(t) && prior ? { ...t, app: prior.app, ...(prior.stageName && !t.stageName ? { stageName: prior.stageName } : {}) } : t
  const run: DeployRun = isTracked ? { ...named, triggeredAt: now, isTracked } : { ...named, triggeredAt: now }
  return [run, ...known.filter(r => !isSame(r))].slice(0, MAX_RUNS)
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
