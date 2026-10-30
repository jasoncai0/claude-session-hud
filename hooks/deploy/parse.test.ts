import { expect, test } from 'claude-code/testing'

import type { DeployRun } from '../../types'
import { LIST_MAX } from '../settings'
import { addRun, envOfStage, findStageTargets, isSettled, isUnnamed, pickExecution, pipelineLabel, progressOf, runOf, stageOfPipeline, stateOf, triggersOf } from './parse'

const WF = '0123456789abcdef0123456789abcdef'
const ST = 'fedcba9876543210fedcba9876543210'
const URL = `https://devops.aliyun.com/appstack/app/demo-api/workflow/${WF}/stage/${ST}/current`
/** What yunxiao-deploy's deploy.sh prints for an AppStack release. */
const DEPLOY_OUT = [
  '──────────────────────────────────────────────',
  ' Type    : AppStack application',
  ' App     : demo-api',
  ' Env     : prod  (stage: 生产 / workflow: 标准发布流程)',
  ' Branch  : release/online',
  ' Source  : demo-api',
  ' Feature : 用户资料：公开字段可读',
  '──────────────────────────────────────────────',
  'Triggering release stage ...',
  '',
  `Triggered. View: ${URL}`,
  'Flow run:      https://flow.aliyun.com/pipelines/1234567/builds/194',
  'Labelled: 用户资料：公开字段可读',
].join('\n')
/** The single trigger of a call, or null: the shape the earlier tests were written against. */
const triggerOne = (...a: Parameters<typeof triggersOf>) => triggersOf(...a)[0] ?? null
const CMD = 'bash ~/.claude/skills/yunxiao-deploy/scripts/deploy.sh demo-api prod release/online --feature "x" --yes'

test('triggerOf reads a deploy.sh run: stage, env, stage name, branch, feature', () => {
  expect(triggerOne('Bash', { command: CMD }, DEPLOY_OUT, false)).toEqual({
    key: `demo-api/${ST}`, app: 'demo-api', workflowSn: WF, stageSn: ST, url: URL,
    env: 'prod', stageName: '生产', branch: 'release/online', feature: '用户资料：公开字段可读',
    flowPipelineId: '1234567', flowRunId: '194',
  })
})

test('triggersOf: two deploy.sh calls whose output was cut to the Flow run lines give two runs, by order', () => {
  const cmd = [
    'cd ~/scripts',
    'bash deploy.sh demo-api prod release/online --yes --feature "$F" 2>&1 | grep -E "Commit|Flow run|ERROR"',
    'bash deploy.sh demo-api-cn prod release/prod --yes --feature "$F" 2>&1 | grep -E "Commit|Flow run|ERROR"',
  ].join('\n')
  const out = [
    '=== demo-api prod release/online ===', ' Commit  : <unreadable>', 'Flow run:      https://flow.aliyun.com/pipelines/1234567/builds/196',
    '=== demo-api-cn prod release/prod ===', ' Commit  : <unreadable>', 'Flow run:      https://flow.aliyun.com/pipelines/7654321/builds/18',
  ].join('\n')
  expect(triggersOf('Bash', { command: cmd }, out, false)).toEqual([
    { key: 'flow/1234567', app: 'demo-api', workflowSn: '', stageSn: '', url: 'https://flow.aliyun.com/pipelines/1234567/builds/196', env: 'prod', branch: 'release/online', flowPipelineId: '1234567', flowRunId: '196' },
    { key: 'flow/7654321', app: 'demo-api-cn', workflowSn: '', stageSn: '', url: 'https://flow.aliyun.com/pipelines/7654321/builds/18', env: 'prod', branch: 'release/prod', flowPipelineId: '7654321', flowRunId: '18' },
  ])
})

test('triggersOf: a loop over one deploy.sh call counts its links; variable words are not taken as names', () => {
  const cmd = 'for x in a b; do bash deploy.sh "$app" prod release/online --yes 2>&1 | grep "Flow run"; done'
  const out = 'Flow run: https://flow.aliyun.com/pipelines/111/builds/5\nFlow run: https://flow.aliyun.com/pipelines/222/builds/6'
  const runs = triggersOf('Bash', { command: cmd }, out, false)
  expect(runs.map(r => `${r.app}|${r.env ?? ''}|${r.flowRunId}`)).toEqual(['流水线 111|prod|5', '流水线 222|prod|6'])
})

test('triggerOf ignores dry runs, failures, other tools and unrelated commands', () => {
  // deploy.sh --dry-run still prints `Triggered.` and the latest existing run: the flag in the command decides.
  expect(triggerOne('Bash', { command: `${CMD} --dry-run` }, DEPLOY_OUT, false)).toBe(null)
  expect(triggerOne('Bash', { command: CMD }, 'Exit code 1\nERROR: branch release/online not found', true)).toBe(null)
  expect(triggerOne('Read', { command: CMD }, DEPLOY_OUT, false)).toBe(null)
  expect(triggerOne('Bash', { command: 'cat deploy-log.tsv' }, URL, false)).toBe(null)
})

test('triggersOf keeps the releases a command triggered before a later part of it failed', () => {
  // `deploy.sh … ; echo =====X; deploy.sh …` exits 1 at the echo under zsh, after the first release was triggered.
  const cmd = `${CMD} | tail -15; echo =====PRE; bash deploy.sh demo-api pre release/pre --yes`
  expect(triggerOne('Bash', { command: cmd }, `Exit code 1\n${DEPLOY_OUT}\n(eval):1: ====PRE not found`, true)).toMatchObject({
    key: `demo-api/${ST}`, flowPipelineId: '1234567', flowRunId: '194',
  })
})

test('triggersOf counts a failed execute call only by the run it printed', () => {
  const cmd = `aliyun devops app-stack-execute-change-request-release-stage --app-name demo-api --release-workflow-sn ${WF} --release-stage-sn ${ST}`
  expect(triggersOf('Bash', { command: cmd }, 'Exit code 1\nERROR: SDK.ServerError', true)).toEqual([])
  expect(triggersOf('Bash', { command: cmd }, 'Exit code 1\n{"pipelineId": 1234567, "pipelineRunId": 9}', true).map(r => r.key)).toEqual([`demo-api/${ST}`])
})

test('triggerOf reads a direct release-stage execute call from its flags', () => {
  const cmd = `aliyun devops app-stack-execute-change-request-release-stage --app-name demo-api --release-workflow-sn ${WF} --release-stage-sn ${ST} --params '{"demo-api":"dev"}'`
  expect(triggerOne('Bash', { command: cmd }, '{"ok":true}', false)).toEqual({ key: `demo-api/${ST}`, app: 'demo-api', workflowSn: WF, stageSn: ST, url: URL })
  expect(triggerOne('Bash', { command: `${cmd} --cli-dry-run` }, '', false)).toBe(null)
})

test('triggersOf reads execute calls made through a shell function from the pipeline runs they printed', () => {
  const cmd = 'trig(){ R=$(yx app-stack-execute-change-request-release-stage --app-name $app --release-workflow-sn $wf --release-stage-sn $st --params "$P"); echo "$app $br => $R"; }; '
    + `trig demo-api ${WF} ${ST} main; trig billing-svc ${WF} ${ST} main`
  const out = 'demo-api main => {"object": 444,"pipelineId": 3191562,"pipelineRunId": 444}\nbilling-svc main => {"object": 95,"pipelineId": 5077580,"pipelineRunId": 95}'
  const runs = triggersOf('Bash', { command: cmd }, out, false)
  expect(runs.map(r => [r.flowPipelineId, r.flowRunId, isUnnamed(r)])).toEqual([['3191562', '444', true], ['5077580', '95', true]])
  expect(runs[0]?.url).toBe('https://flow.aliyun.com/pipelines/3191562/builds/444')
})

test('addRun puts the newest first and starts a re-triggered stage over', () => {
  const t = triggerOne('Bash', { command: CMD }, DEPLOY_OUT, false)
  if (!t) throw new Error('no trigger')
  const old: DeployRun = { ...t, triggeredAt: 1, number: '193', status: 'SUCCESS' }
  const other: DeployRun = { ...t, key: 'x/y', app: 'x', flowPipelineId: '999', triggeredAt: 2 }
  const runs = addRun([other, old], t, 9)
  expect(runs.map(r => r.key)).toEqual([t.key, 'x/y'])
  expect(runs[0]?.number).toBe(undefined)
  expect(runs[0]?.triggeredAt).toBe(9)
})

test('pickExecution takes the latest execution unless it started before the trigger', () => {
  const at = Date.parse('2026-10-15T10:07:00Z')
  expect(pickExecution({ number: '194', startTime: '2026-10-15T10:07:46.000+00:00' }, at)).toBe('194')
  expect(pickExecution({ number: 194, startTime: '2026-10-15T10:06:00Z' }, at)).toBe('194')
  expect(pickExecution({ number: '193', startTime: '2026-10-14T10:00:00Z' }, at)).toBe(undefined)
  expect(pickExecution(undefined, at)).toBe(undefined)
})

const API_RUN = {
  pipelineRun: {
    status: 'FAIL',
    stages: [
      { name: '构建', stageInfo: { status: 'SUCCESS', jobs: [{ name: '镜像构建', status: 'SUCCESS' }] } },
      { name: '部署', stageInfo: { status: 'SUCCESS', jobs: [{ name: '预热发布', status: 'SUCCESS' }] } },
      { name: '部署', stageInfo: { status: 'FAIL', jobs: [{ name: '灰度人工卡点', status: 'FAIL' }, { name: '全量发布', status: 'INIT' }] } },
    ],
  },
}

test('runOf flattens a getPipelineRun answer; progressOf names the job it stopped at', () => {
  const run = runOf(API_RUN)
  expect(run.status).toBe('FAIL')
  expect(run.stages.map(s => `${s.name}:${s.status}:${s.jobs.length}`)).toEqual(['构建:SUCCESS:1', '部署:SUCCESS:1', '部署:FAIL:2'])
  const base: DeployRun = { key: 'k', app: 'demo-api', workflowSn: WF, stageSn: ST, url: URL, triggeredAt: 0, number: '194', ...run }
  expect(progressOf(base)).toBe('✕ 灰度人工卡点 (2/4)')
  expect(progressOf({ ...base, stages: [{ name: '构建', status: 'RUNNING', jobs: [{ name: '镜像构建', status: 'RUNNING' }] }] })).toBe('◐ 镜像构建 (0/1)')
  expect(progressOf({ ...base, stages: [{ name: '部署', status: 'SUCCESS', jobs: [{ name: '全量发布', status: 'SUCCESS' }] }] })).toBe('✓ 全量发布 (1/1)')
  expect(progressOf({ ...base, number: undefined, stages: undefined })).toBe('等待运行开始')
  expect(progressOf({ ...base, error: 'AppStack 403' })).toBe('查询失败：无权限')
  expect(progressOf({ ...base, error: 'TLS handshake timeout' })).toBe('✕ 灰度人工卡点 (2/4)')
  expect(progressOf({ ...base, stages: undefined, error: 'TLS handshake timeout' })).toBe('查询失败：网络超时，稍后重试')
})

test('findStageTargets finds every stage link once; envOfStage names the env', () => {
  const other = `https://devops.aliyun.com/appstack/app/auth-svc/workflow/${WF}/stage/${'a'.repeat(32)}/current`
  expect(findStageTargets(`看下 ${URL} 和 ${other}，还有 ${URL}`).map(t => t.key)).toEqual([`demo-api/${ST}`, `auth-svc/${'a'.repeat(32)}`])
  expect(findStageTargets('https://flow.aliyun.com/pipelines/1/builds/2')).toEqual([])
  expect(envOfStage('生产阶段')).toBe('prod')
  expect(envOfStage('预发阶段')).toBe('pre')
  expect(envOfStage('测试阶段_cn')).toBe('test')
  expect(envOfStage('其他阶段')).toBe('其他')
})

test('addRun marks a tracked run; runOf reads the branch the run built', () => {
  const [t] = findStageTargets(URL)
  if (!t) throw new Error('no target')
  expect(addRun([], t, 5, true)[0]?.isTracked).toBe(true)
  expect('isTracked' in (addRun([], t, 5)[0] ?? {})).toBe(false)
  expect(runOf({ pipelineRun: { status: 'SUCCESS', stages: [], sources: [{ data: { branch: 'release/online' } }] } }).branch).toBe('release/online')
  expect('branch' in runOf({ pipelineRun: { status: 'SUCCESS' } })).toBe(false)
})

test('isSettled: only a pinned run in a final state stops being polled; stateOf labels states', () => {
  const base: DeployRun = { key: 'k', app: 'a', workflowSn: WF, stageSn: ST, url: URL, triggeredAt: 0 }
  expect(isSettled(base)).toBe(false)
  expect(isSettled({ ...base, number: '1', status: 'RUNNING' })).toBe(false)
  expect(isSettled({ ...base, number: '1', status: 'SUCCESS' })).toBe(true)
  expect(isSettled({ ...base, number: '1', status: 'FAIL' })).toBe(true)
  expect(stateOf('WAITING').label).toBe('待确认')
  expect(stateOf(undefined).label).toBe('查询中')
  expect(stateOf('ODD').label).toBe('ODD')
})

test('addRun: the same Flow pipeline replaces its row however it was recorded, keeping its name; LIST_MAX runs are kept', () => {
  const t = triggerOne('Bash', { command: CMD }, DEPLOY_OUT, false)
  if (!t) throw new Error('no trigger')
  const loop = 'for x in a; do bash deploy.sh "$app" prod --yes | grep "Flow run"; done'
  const [again] = triggersOf('Bash', { command: loop }, 'Flow run: https://flow.aliyun.com/pipelines/1234567/builds/195', false)
  if (!again) throw new Error('no flow trigger')
  expect(isUnnamed(again)).toBe(true)
  const runs = addRun(addRun([], t, 1), again, 2)
  expect(runs.map(r => `${r.key}|${r.app}|${r.flowRunId}`)).toEqual(['flow/1234567|demo-api|195'])
  expect(isUnnamed(runs[0] ?? again)).toBe(false)
  const many = Array.from({ length: LIST_MAX + 10 }, (_, i) => ({ ...t, key: `k${i}`, flowPipelineId: String(i) }))
  expect(many.reduce((acc, m, i) => addRun(acc, m, i), [] as DeployRun[]).length).toBe(LIST_MAX)
})

test('pipelineLabel reads app, stage and env from an AppStack-made pipeline name', () => {
  expect(pipelineLabel('demo-api-标准发布流程-生产阶段')).toEqual({ app: 'demo-api', stageName: '生产阶段', env: 'prod' })
  expect(pipelineLabel('billing-svc-cn-标准发布流程-预发阶段_cn')).toEqual({ app: 'billing-svc-cn', stageName: '预发阶段_cn', env: 'pre' })
  expect(pipelineLabel('my-custom-pipeline')).toEqual({ app: 'my-custom-pipeline' })
})

test('stageOfPipeline finds the release stage that runs a Flow pipeline', () => {
  const workflows = [
    { sn: 'w1', releaseStages: [{ sn: 's-test', name: '测试阶段', pipeline: { id: 11 } }] },
    { sn: WF, releaseStages: [{ sn: 's-pre', name: '预发阶段', pipeline: null }, { sn: ST, name: '生产阶段', pipeline: { id: 1234567 } }] },
  ]
  expect(stageOfPipeline(workflows, '1234567')).toEqual({ workflowSn: WF, stageSn: ST, stageName: '生产阶段' })
  expect(stageOfPipeline(workflows, '999')).toBe(undefined)
  expect(stageOfPipeline({ error: 'x' }, '11')).toBe(undefined)
})
