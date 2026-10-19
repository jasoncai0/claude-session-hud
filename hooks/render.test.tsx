import { expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'

const PLUGIN = 'session-hud'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 160, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const turn = (answer = ''): TurnCompleteInput => ({ reason: 'answer', answer, durationMs: 1, isAborted: false, turnId: 't1' })
const ORG = 'my-org-id'
const START = { cwd: '/w/demo-api/src', surface: null, isInteractive: true } as const
const LONG_BRANCH = 'feature/user-profile-share-permission'
const DOC = 'https://acme.feishu.cn/docx/Doc0123456789abcdefABCD'
const MADE = 'https://www.feishu.cn/docx/NewDoc1234567890abcd'

const mrOf = (repo: string, localId: number, sourceBranch: string) => ({
  localId, detailUrl: `https://codeup.aliyun.com/${ORG}/backend/${repo}/change/${localId}`, title: `t${localId}`,
  sourceBranch, targetBranch: 'release/online', state: 'TO_BE_MERGED', hasConflict: false,
  reviewers: [{ reviewOpinionStatus: 'PASS' }, {}], unResolvedCommentCount: 0,
})
const DETAIL = { checkList: { requirementRuleItems: [{ itemType: 'MERGE_CONFLICT_CHECK', pass: true }] } }
const COMPARE = { diffs: [{ diff: '+a\n+b\n-c' }] }
const REPO_IDS: Record<string, number> = { 'demo-api': 1001, 'billing-svc': 1002 }

/** One Bash call through the engine; the typed overloads of `$.tool.call` are too deep for tsc here. */
type ToolCaller = { tool: { call: (input: { tool: string; command: string }) => Promise<unknown> } }
const bash = ($: unknown, command: string) => ($ as ToolCaller).tool.call({ tool: 'Bash', command })

const WF = '0123456789abcdef0123456789abcdef'
const ST = 'fedcba9876543210fedcba9876543210'
const STAGE_URL = `https://devops.aliyun.com/appstack/app/demo-api/workflow/${WF}/stage/${ST}/current`
const DEPLOY_CMD = 'bash ~/.claude/skills/yunxiao-deploy/scripts/deploy.sh demo-api prod release/online --feature "公开字段可读" --yes'
const DEPLOY_OUT = [' Env     : prod  (stage: 生产 / workflow: 标准发布流程)', ' Branch  : release/online', ' Feature : 公开字段可读', `Triggered. View: ${STAGE_URL}`].join('\n')
/** A release-stage run: built, overseas done, the domestic gate at `status`. */
const releaseRun = (status: string) => ({
  pipelineRun: {
    status,
    stages: [
      { name: '构建', stageInfo: { status: 'SUCCESS', jobs: [{ name: '镜像构建', status: 'SUCCESS' }] } },
      { name: '部署', stageInfo: { status, jobs: [{ name: '灰度人工卡点', status }, { name: '全量发布', status: 'INIT' }] } },
    ],
  },
})

type World = { branch?: string; calls?: string[]; extra?: object[]; toolText?: string; isBranchGone?: boolean; detail?: object; state?: string; release?: { status: string }; larkTimeouts?: { left: number } }

/** Two Codeup checkouts (/w/demo-api is the cwd, /w/billing-svc), lark-cli answering titles, a tool bottom echoing `toolText`. */
function world(on: On, { branch = 'feat', calls = [], extra = [], toolText = '', isBranchGone = false, detail = DETAIL, state = 'TO_BE_MERGED', release = { status: 'RUNNING' }, larkTimeouts = { left: 0 } }: World = {}) {
  mock.env(on, { ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN: 'pt-test', HOME: '/home/me' })
  const clock = mock.clock(on, { now: Date.parse('2026-10-15T10:00:00Z') })
  on('ui.log', async (_$, e) => {
    calls.push(`log ${JSON.stringify(e)}`)
    return { value: undefined } as never
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('prompt.submit', async (_$, e) => ({ text: e.text }) as never)
  on('session.cwd', async () => ({ value: '/w/demo-api/src' }))
  on('session.usage', async () => ({ value: { rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2999-01-01T00:00:00Z' }] } }) as never)
  on('process.run', async (_$, e) => {
    if (String(e.argv[0]).endsWith('lark-cli')) {
      calls.push(`lark ${e.argv.join(' ')}`)
      if (larkTimeouts.left > 0) {
        larkTimeouts.left -= 1
        throw new Error('timed out after 8000ms')
      }
      const title = String(e.argv[4]).includes('NewDoc') ? '新建的设计文档' : '权限设计（正式标题）'
      return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true, data: { title } }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (String(e.argv[0]).endsWith('gh')) {
      calls.push(`gh ${e.argv.slice(1, 3).join(' ')}`)
      const isCompare = String(e.argv[2]).includes('/compare/')
      const ghPr = (n: number, ref: string) => ({
        number: n, url: `https://github.com/acme/gh-app/pull/${n}`, title: `t${n}`, state: 'OPEN', isDraft: false, merged: false, additions: 12, deletions: 3,
        headRefName: ref, baseRefName: 'main', headRef: { name: ref }, headRepositoryOwner: { login: 'acme' }, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
        commits: { totalCount: 2, nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' }] } } } }] },
        reviewThreads: { nodes: [] },
      })
      const query = String(e.argv[4] ?? '')
      const body = isCompare ? { behind_by: 3 } : { data: { repository: { branch: { nodes: query.includes('headRefName') ? [ghPr(7, branch)] : [] }, ...(query.includes('n8:') ? { n8: ghPr(8, 'other') } : {}) } } }
      return { value: { exitCode: 0, stdout: JSON.stringify(body), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const dir = e.argv[2] ?? ''
    if (dir.startsWith('/w/gh-app')) {
      const out = e.argv.includes('rev-parse') ? '/w/gh-app' : e.argv.includes('get-url') ? 'git@github.com:acme/gh-app.git' : branch
      return { value: { exitCode: 0, stdout: `${out}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const root = dir.startsWith('/w/billing-svc') ? '/w/billing-svc' : dir.startsWith('/w/demo-api') ? '/w/demo-api' : ''
    const name = root.split('/').at(-1)
    const out = !root ? '' : e.argv.includes('rev-parse') ? root : e.argv.includes('get-url') ? `git@codeup.aliyun.com:${ORG}/backend/${name}.git` : branch
    return { value: { exitCode: root ? 0 : 128, stdout: `${out}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', async (_$, e) => {
    calls.push(e.url)
    if (e.url.includes('/releaseStageBriefs')) {
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([{ sn: ST, name: '生产阶段' }]) } }
    }
    if (e.url.includes('/appstack/')) {
      const body = e.url.includes(':getPipelineRun') ? releaseRun(release.status) : { data: [{ number: '194', startTime: '2026-10-15T10:00:03Z', state: release.status }] }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
    }
    if (e.url.includes('/flow/organizations/')) {
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(releaseRun(release.status).pipelineRun) } }
    }
    if (e.url.endsWith('/platform/user')) return { value: { status: 200, ok: true, headers: {}, text: '{"id":"u1"}' } }
    if (e.url.includes('authorIds=u1')) {
      const opened = { ...mrOf('billing-svc', 77, 'fix/space-online'), detailUrl: `https://codeup.aliyun.com/${ORG}/backend/billing-svc/change/77`, createdAt: '2026-10-15T18:00:30+08:00' }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([opened]) } }
    }
    if (e.url.includes('/branches/')) {
      return { value: isBranchGone ? { status: 404, ok: false, headers: {}, text: '{"code":404}' } : { status: 200, ok: true, headers: {}, text: '{"name":"feat"}' } }
    }
    const id = Object.entries(REPO_IDS).find(([, v]) => e.url.includes(`projectIds=${v}`) || e.url.includes(`/repositories/${v}/`))
    const body = e.url.includes('/compares') ? COMPARE
      : /\/changeRequests\/\d+$/.test(e.url) ? detail
      : e.url.includes('/changeRequests?') ? [{ ...mrOf(id?.[0] ?? '?', id?.[0] === 'demo-api' ? 191 : 53, branch), state }, ...(id?.[0] === 'demo-api' ? extra : [mrOf('billing-svc', 77, 'fix/space-online')])]
      : { id: REPO_IDS[decodeURIComponent(e.url).split('/').at(-1) ?? ''] }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('tool.call', async () => ({ result: 'ok', text: toolText }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return clock
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: MR row shows stats, checks, link; expands and dismisses`, async ($, on) => {
    world(on)
    await $.turn.complete(turn())
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: '待合并' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+2' })).toBeDefined()
    expect((await ui.find({ type: 'Link', text: '!191' }))?.props.href).toBe(`https://codeup.aliyun.com/${ORG}/backend/demo-api/change/191`)
    expect(await ui.find({ type: 'Link', text: '打开 ↗' })).toBeUndefined()

    await ui.press({ key: 'checks-backend/demo-api!191' })
    expect(await ui.find({ type: 'Text', text: '评审 1/2' })).toBeDefined()
    await ui.press({ key: 'checks-fold-backend/demo-api!191' })
    expect(await ui.find({ type: 'Text', text: '评审 1/2' })).toBeUndefined()
    await ui.press({ key: 'checks-backend/demo-api!191' })

    await ui.press({ key: 'dismiss-backend/demo-api!191' })
    expect(await ui.find({ type: 'Text', text: '待合并' })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a long branch is cut to its column and shown whole on hover`, async ($, on) => {
    world(on, { branch: LONG_BRANCH })
    await $.turn.complete(turn())
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: 'feature/user…-permission' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: LONG_BRANCH })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: fold collapses every module into one summary row`, async ($, on) => {
    world(on)
    await $.session.start(START)
    await $.turn.complete(turn(`见 ${DOC}`))
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: '待合并' })).toBeDefined()
    await ui.press({ key: 'hud-fold' })
    expect(await ui.find({ type: 'Text', text: '待合并' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '⑂!191' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '文档 1' })).toBeDefined()
    await ui.press({ key: 'hud-fold' })
    expect(await ui.find({ type: 'Text', text: '待合并' })).toBeDefined()
    await ui.unmount()
  })
}

test('a doc made by lark-cli shows as 创建 with its looked-up title; one in the answer as 提及', async ($, on) => {
  const calls: string[] = []
  const clock = world(on, { calls, toolText: JSON.stringify({ ok: true, data: { url: MADE } }) })
  await bash($, 'lark-cli docs +create --title 设计')
  await $.turn.complete(turn(`参考 [权限设计](${DOC})`))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  // Before the lookup: the link text stands in for the title.
  expect(await ui.find({ type: 'Link', text: '权限设计' })).toBeDefined()
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: '创建' })).toBeDefined()
  expect((await ui.find({ type: 'Link', text: '新建的设计文档' }))?.props.href).toBe(MADE)
  expect(await ui.find({ type: 'Text', text: '提及' })).toBeDefined()
  expect((await ui.find({ type: 'Link', text: '权限设计（正式标题）' }))?.props.href).toBe(DOC)
  expect(await ui.find({ type: 'Text', text: '文档' })).toBeDefined()
  expect(calls.filter(c => c.startsWith('lark ')).length).toBe(2)

  await $.turn.complete(turn())
  await clock.advance(1)
  expect(calls.filter(c => c.startsWith('lark ')).length).toBe(2)

  await ui.press({ key: 'doc-dismiss-Doc0123456789abcdefABCD' })
  expect(await ui.find({ type: 'Link', text: '权限设计（正式标题）' })).toBeUndefined()
  await ui.unmount()
})

test('a narrow band shrinks the name columns and keeps every MR control', async ($, on) => {
  world(on, { branch: LONG_BRANCH })
  await $.turn.complete(turn())
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 90 } })
  expect(await ui.find({ type: 'Button', key: 'dismiss-backend/demo-api!191' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: LONG_BRANCH })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'feature/user…-permission' })).toBeUndefined()
  await ui.unmount()
})

test('checks show merge progress, lag behind target and the source branch; a press refetches them', async ($, on) => {
  const calls: string[] = []
  world(on, { calls, detail: { ...DETAIL, ahead: 3, behind: 9 } })
  await $.turn.complete(turn())
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const before = calls.length
  await ui.press({ key: 'checks-backend/demo-api!191' })
  expect(await ui.find({ type: 'Text', text: '待合入 3 个提交' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '落后 release/online 9 个提交' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '源分支存在' })).toBeDefined()
  expect(calls.length > before).toBe(true)
  await ui.unmount()
})

test('a merged MR whose source branch is gone shows both as passed', async ($, on) => {
  world(on, { isBranchGone: true, state: 'MERGED' })
  await $.turn.complete(turn())
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  await ui.press({ key: 'checks-backend/demo-api!191' })
  expect(await ui.find({ type: 'Text', text: '已合入 release/online' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '源分支已删除' })).toBeDefined()
  await ui.unmount()
})

test('a release triggered by deploy.sh shows its AppStack link and polls its run until it settles', async ($, on) => {
  const calls: string[] = []
  const release = { status: 'RUNNING' }
  const clock = world(on, { calls, toolText: DEPLOY_OUT, release })
  await $.session.start(START)
  await bash($, DEPLOY_CMD)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Link', text: 'demo-api' }))?.props.href).toBe(STAGE_URL)
  expect(await ui.find({ type: 'Text', text: '查询中' })).toBeDefined()

  await clock.advance(5_000)
  expect(await ui.find({ type: 'Text', text: '运行中' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '◐ 灰度人工卡点 (1/3)' })).toBeDefined()
  expect(calls.some(u => u.includes(`/appstack/organizations/${ORG}/apps/demo-api/releaseWorkflows/${WF}/releaseStages/${ST}/executions/194:getPipelineRun`))).toBe(true)

  release.status = 'FAIL'
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: '失败' })).toBeDefined()
  const settled = calls.filter(u => u.includes('/appstack/')).length
  await clock.advance(60_000)
  expect(calls.filter(u => u.includes('/appstack/')).length).toBe(settled)

  // 检查 unfolds every job and fetches afresh, even a settled run.
  await ui.press({ key: `deploy-check-demo-api/${ST}` })
  expect(await ui.find({ type: 'Text', text: '✓ 镜像构建' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '发布说明：公开字段可读' })).toBeDefined()
  expect(calls.filter(u => u.includes('/appstack/')).length > settled).toBe(true)
  await ui.unmount()
})

test('a stage link pasted in a prompt is tracked: its latest run, env from the stage name, branch from the run', async ($, on) => {
  const calls: string[] = []
  world(on, { calls, release: { status: 'FAIL' } })
  await $.prompt.submit({ text: `帮我看下这个发布 ${STAGE_URL}` } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Link', text: 'demo-api' }))?.props.href).toBe(STAGE_URL)
  expect(await ui.find({ type: 'Text', text: 'prod' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '失败' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✕ 灰度人工卡点 (1/3)' })).toBeDefined()
  expect(calls.some(u => u.includes('/releaseStageBriefs'))).toBe(true)
  await ui.unmount()
})

test('/deploys <link> tracks the stage and lists it', async ($, on) => {
  world(on, { release: { status: 'RUNNING' } })
  const out = await $.command.run({ command: 'deploys', args: STAGE_URL } as never) as { text?: string }
  expect(out.text).toContain('**demo-api**（跟踪）')
  expect(out.text).toContain('运行中 #194')
})

test('two deploys in one command, output cut to its Flow run lines, both show and read the Flow runs', async ($, on) => {
  const calls: string[] = []
  const toolText = ['=== demo-api ===', 'Flow run:      https://flow.aliyun.com/pipelines/1234567/builds/196', '=== demo-api-cn ===', 'Flow run:      https://flow.aliyun.com/pipelines/7654321/builds/18'].join('\n')
  const clock = world(on, { calls, toolText, release: { status: 'RUNNING' } })
  await bash($, 'bash deploy.sh demo-api prod release/online --yes 2>&1 | grep "Flow run"\nbash deploy.sh demo-api-cn prod release/prod --yes 2>&1 | grep "Flow run"')
  await clock.advance(5_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Link', text: 'demo-api' }))?.props.href).toBe('https://flow.aliyun.com/pipelines/1234567/builds/196')
  expect((await ui.find({ type: 'Link', text: 'demo-api-cn' }))?.props.href).toBe('https://flow.aliyun.com/pipelines/7654321/builds/18')
  expect(calls.some(u => u.includes(`/flow/organizations/${ORG}/pipelines/7654321/runs/18`))).toBe(true)
  expect(calls.some(u => u.includes('/executions'))).toBe(false)
  await ui.unmount()
})

test('an MR opened by a CLI call that prints only its id still shows, found by author and time', async ($, on) => {
  const calls: string[] = []
  world(on, { calls, branch: 'lonely', toolText: '  海外 -> release/online  localId= 77' })
  await bash($, 'yx codeup-create-change-request --repository-id 1002 --source-branch "$src" --target-branch "$tgt" --title t')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Link', text: '!77' }))?.props.href).toBe(`https://codeup.aliyun.com/${ORG}/backend/billing-svc/change/77`)
  expect(calls.some(u => u.includes('authorIds=u1') && u.includes('orderBy=created_at'))).toBe(true)
  await ui.unmount()
})

test('a Codeup MR link in a prompt pins that MR', async ($, on) => {
  world(on, { branch: 'lonely' })
  await $.prompt.submit({ text: `看下 https://codeup.aliyun.com/${ORG}/backend/demo-api/change/191` } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Link', text: '!191' })).toBeDefined()
  await ui.unmount()
})

test('a GitHub checkout the session works in shows its PR with the same checks, plus CI', async ($, on) => {
  const calls: string[] = []
  world(on, { calls })
  await bash($, 'cd /w/gh-app && git status')
  await $.turn.complete(turn())
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Link', text: '#7' }))?.props.href).toBe('https://github.com/acme/gh-app/pull/7')
  expect(await ui.find({ type: 'Text', text: 'acme/gh-app' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+12' })).toBeDefined()
  await ui.press({ key: 'checks-acme/gh-app#7' })
  expect(await ui.find({ type: 'Text', text: '落后 main 3 个提交' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'CI 失败：build' })).toBeDefined()
  expect(calls.some(c => c.startsWith('gh api graphql'))).toBe(true)
  await ui.unmount()
})

test('a GitHub PR link in a prompt pins that PR', async ($, on) => {
  world(on, { branch: 'lonely' })
  await $.prompt.submit({ text: '看下 https://github.com/acme/gh-app/pull/8' } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Link', text: '#8' })).toBeDefined()
  await ui.unmount()
})

test('an Artifact publish shows as 创建 with its page title, the title linking to the artifact; no lark lookup', async ($, on) => {
  const calls: string[] = []
  const art = 'https://claude.ai/code/artifact/38259d61-6573-4493-a61c-adce693a2b57'
  const clock = world(on, { calls, toolText: `Published /tmp/s/report.html at ${art}` })
  on('fs.read', async (_$, e) => ({ value: String(e.path).endsWith('report.html') ? '<html><title>评审报告</title></html>' : '' }) as never)
  await (($ as unknown) as { tool: { call: (i: object) => Promise<unknown> } }).tool.call({ tool: 'Artifact', file_path: '/tmp/s/report.html' })
  await $.turn.complete(turn())
  await clock.advance(1)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Link', text: '评审报告' }))?.props.href).toBe(art)
  expect(await ui.find({ type: 'Text', text: '创建' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Claude' })).toBeDefined()
  expect(calls.filter(c => c.startsWith('lark '))).toEqual([])
  await ui.unmount()
})

test('docsArtifacts off: artifact links are left out', { options: { docsArtifacts: false, mr: false } }, async ($, on) => {
  world(on)
  await $.turn.complete(turn('see https://claude.ai/code/artifact/38259d61-6573-4493-a61c-adce693a2b57'))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'Claude' })).toBeUndefined()
  await ui.unmount()
})

test('while a card holds the band, the HUD stays as one summary line above it with nothing to press', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.turn.complete(turn())
  const card = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await card.find({ type: 'Text', text: '42%' })).toBeDefined()
  expect(await card.find({ type: 'Text', text: '⑂!191' })).toBeDefined()
  expect(await card.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await card.find({ type: 'Button', key: 'hud-fold' })).toBeUndefined()
  expect(await card.find({ type: 'Text', text: '待合并' })).toBeUndefined()
  await card.unmount()

  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await after.find({ type: 'Text', text: '待合并' })).toBeDefined()
  expect(await after.find({ type: 'Button', key: 'hud-fold' })).toBeDefined()
  await after.unmount()
})

test('a release row\'s 检查 folds again on a second press, as an MR row does', async ($, on) => {
  const clock = world(on, { toolText: DEPLOY_OUT, release: { status: 'FAIL' } })
  await $.session.start(START)
  await bash($, DEPLOY_CMD)
  await clock.advance(5_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const key = `deploy-check-demo-api/${ST}`
  await ui.press({ key })
  expect(await ui.find({ type: 'Text', text: '✓ 镜像构建' })).toBeDefined()
  await ui.press({ key })
  expect(await ui.find({ type: 'Text', text: '✓ 镜像构建' })).toBeUndefined()
  await ui.press({ key })
  expect(await ui.find({ type: 'Text', text: '✓ 镜像构建' })).toBeDefined()
  // The 收起 at the end of the unfolded list folds it too: in reach when a tall band has scrolled the row away.
  await ui.press({ key: `deploy-fold-demo-api/${ST}` })
  expect(await ui.find({ type: 'Text', text: '✓ 镜像构建' })).toBeUndefined()
  await ui.unmount()
})

test('deploy off: a deploy.sh run is not tracked', { options: { deploy: false, mr: false } }, async ($, on) => {
  const calls: string[] = []
  const clock = world(on, { calls, toolText: DEPLOY_OUT })
  await bash($, DEPLOY_CMD)
  await clock.advance(10_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Link', text: 'demo-api' })).toBeUndefined()
  expect(calls.filter(u => u.includes('/appstack/'))).toEqual([])
  await ui.unmount()
})

test('a title lookup that times out is retried on a later turn, not given up', async ($, on) => {
  const calls: string[] = []
  const clock = world(on, { calls, toolText: JSON.stringify({ ok: true, data: { url: MADE } }), larkTimeouts: { left: 1 } })
  await bash($, 'lark-cli docs +create --title 设计')
  await $.turn.complete(turn())
  await clock.advance(1)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Link', text: '新建的设计文档' })).toBeUndefined()

  await $.turn.complete(turn())
  await clock.advance(1)
  expect(await ui.find({ type: 'Link', text: '新建的设计文档' })).toBeDefined()
  expect(calls.filter(c => c.startsWith('lark ')).length).toBe(2)
  await ui.unmount()
})

test('docsMaxRows: more documents unfold in place, nothing to type', { options: { docsMaxRows: 2, mr: false } }, async ($, on) => {
  world(on)
  const links = ['A', 'B', 'C'].map(c => `https://acme.feishu.cn/docx/${c.repeat(22)}`).join(' ')
  await $.turn.complete(turn(links))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Button', key: 'docs-more' }))?.props.label).toBe('⌄ 展开另 2 篇文档')
  await ui.press({ key: 'docs-more' })
  expect(await ui.find({ type: 'Button', key: 'doc-dismiss-' + 'A'.repeat(22) })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'doc-dismiss-' + 'C'.repeat(22) })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'docs-more' }))?.props.label).toBe('⌃ 收起')
  await ui.unmount()
})

test('a second repo touched by Bash joins the band', async ($, on) => {
  world(on)
  await bash($, 'cd /w/billing-svc && git push')
  await $.turn.complete(turn())
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'backend/billing-svc' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'backend/demo-api' })).toBeDefined()
  await ui.unmount()
})

test('one branch with MRs into two targets shows both open ones, hides the closed one, reuses diff stats', async ($, on) => {
  const calls: string[] = []
  const extra = [
    { ...mrOf('demo-api', 192, 'feat'), targetBranch: 'release/prod', state: 'UNDER_REVIEW' },
    { ...mrOf('demo-api', 190, 'feat'), state: 'CLOSED' },
  ]
  world(on, { calls, extra })
  await $.turn.complete(turn())
  await $.turn.complete(turn())
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Link', text: '!191' })).toBeDefined()
  expect(await ui.find({ type: 'Link', text: '!192' })).toBeDefined()
  expect(await ui.find({ type: 'Link', text: '!190' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '评审中' })).toBeDefined()
  expect(calls.filter(u => u.includes('/compares')).length).toBe(2)
  await ui.unmount()
})

test('mrMaxRows caps the MR rows with a count of the rest', { options: { mrMaxRows: 1 } }, async ($, on) => {
  world(on, { extra: [{ ...mrOf('demo-api', 192, 'feat'), targetBranch: 'release/prod' }] })
  await $.turn.complete(turn())
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Link', text: '!191' })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'mr-more' }))?.props.label).toBe('⌄ 展开另 2 个 MR')

  await ui.press({ key: 'mr-more' })
  expect(await ui.find({ type: 'Link', text: '!191' })).toBeDefined()
  expect(await ui.find({ type: 'Link', text: '!192' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'mr-more' }))?.props.label).toBe('⌃ 收起')

  await ui.press({ key: 'mr-more' })
  expect(await ui.find({ type: 'Link', text: '!191' })).toBeUndefined()
  await ui.unmount()
})

test('a module switched off draws nothing and calls nothing', { options: { mr: false, docs: false } }, async ($, on) => {
  const calls: string[] = []
  world(on, { calls })
  await $.session.start(START)
  await $.turn.complete(turn(`见 ${DOC}`))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '待合并' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '提及' })).toBeUndefined()
  expect(calls.filter(c => !c.startsWith('log '))).toEqual([])
  await ui.unmount()
})

test('docsMentioned off keeps only created docs', { options: { docsMentioned: false, mr: false } }, async ($, on) => {
  world(on, { toolText: MADE })
  await bash($, 'lark-cli docs +create --title 设计')
  await $.turn.complete(turn(`见 ${DOC}`))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: '创建' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '提及' })).toBeUndefined()
  await ui.unmount()
})
