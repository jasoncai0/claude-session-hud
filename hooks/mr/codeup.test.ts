import { expect, test } from 'claude-code/testing'

import { LIST_MAX } from '../settings'
import { addPins, shownPins, branchChecks, checksOf, createdSince, findMrLinks, isMrCreation, diffStat, repoLabel, thousands, parseRemote, pickMrs, stateOf, summarize, toView, tokenFromProfile } from './codeup'
import type { ApiChangeRequest } from './codeup'

const ORG = 'my-org-id'

test('parseRemote handles ssh and https Codeup remotes, rejects others', () => {
  const want = { org: ORG, path: `${ORG}/backend/demo-api` }
  expect(parseRemote(`git@codeup.aliyun.com:${ORG}/backend/demo-api.git\n`)).toEqual(want)
  expect(parseRemote(`https://codeup.aliyun.com/${ORG}/backend/demo-api.git`)).toEqual(want)
  expect(parseRemote(`https://jason@codeup.aliyun.com/${ORG}/backend/demo-api`)).toEqual(want)
  expect(parseRemote('git@github.com:jasoncai0/claude-usage-hud.git')).toBe(null)
  expect(parseRemote('')).toBe(null)
})

test('tokenFromProfile takes the last export line and strips quotes/comments', () => {
  const profile = [
    '# export ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN=commented',
    'export ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN=pt-old',
    '  export ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN="pt-new" # latest',
  ].join('\n')
  expect(tokenFromProfile(profile)).toBe('pt-new')
  expect(tokenFromProfile('export OTHER=1')).toBe(undefined)
})

const cr = (localId: number, sourceBranch: string, state: string, extra: Partial<ApiChangeRequest> = {}): ApiChangeRequest => ({
  localId, sourceBranch, state, detailUrl: `u/${localId}`, title: `t${localId}`, targetBranch: 'master', ...extra,
})

test('pickMrs prefers open MRs of the branch, else the latest closed one', () => {
  const list = [cr(9, 'other', 'TO_BE_MERGED'), cr(8, 'feat', 'MERGED'), cr(7, 'feat', 'UNDER_REVIEW'), cr(6, 'feat', 'CLOSED')]
  expect(pickMrs(list, 'feat').map(m => m.localId)).toEqual([7])
  expect(pickMrs([cr(8, 'feat', 'MERGED'), cr(6, 'feat', 'CLOSED')], 'feat').map(m => m.localId)).toEqual([8])
  expect(pickMrs(list, 'none')).toEqual([])
})

test('diffStat counts +/- lines and skips file headers', () => {
  const diff = '--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n ctx\n-old\n+new\n+more'
  expect(diffStat({ diffs: [{ diff }, { diff: '+one' }] })).toEqual({ additions: 3, deletions: 1 })
  expect(diffStat({})).toEqual({ additions: 0, deletions: 0 })
})

test('checksOf folds requirements, reviews and comments; summarize ranks fail > pending > pass', () => {
  const mr = cr(7, 'feat', 'UNDER_REVIEW', {
    hasConflict: true,
    unResolvedCommentCount: 2,
    reviewers: [{ reviewOpinionStatus: 'PASS' }, {}],
  })
  const checks = checksOf(mr, { checkList: { requirementRuleItems: [{ itemType: 'MERGE_CONFLICT_CHECK', pass: false }] } })
  expect(checks).toEqual([
    { label: '待合入', status: 'pending' },
    { label: '合并冲突检查', status: 'fail' },
    { label: '评审 1/2', status: 'pending' },
    { label: '未解决评论 2', status: 'pending' },
  ])
  expect(summarize(checks)).toBe('fail')
  expect(summarize(checks.filter(c => c.status !== 'fail'))).toBe('pending')
  expect(summarize([{ label: 'x', status: 'pass' }])).toBe('pass')
  expect(summarize([])).toBe('none')
  expect(checksOf(cr(1, 'f', 'TO_BE_MERGED', { hasConflict: true }), undefined).at(-1)).toEqual({ label: '存在冲突', status: 'fail' })
})

test('toView carries repo name and optional stats', () => {
  const v = toView(cr(7, 'feat', 'TO_BE_MERGED'), `${ORG}/backend/demo-api`, undefined, { additions: 1, deletions: 1 })
  expect(v).toEqual({ id: 7, url: 'u/7', title: 't7', repo: 'backend/demo-api', source: 'feat', target: 'master', state: 'TO_BE_MERGED', additions: 1, deletions: 1, checks: [{ label: '待合入', status: 'pending' }] })
  expect('additions' in toView(cr(7, 'feat', 'MERGED'), 'o/r')).toBe(false)
})


test('stateOf maps known states and passes unknown through', () => {
  expect(stateOf('TO_BE_MERGED').label).toBe('待合并')
  expect(stateOf('MERGED').tone).toBe('merged')
  expect(stateOf('WEIRD').label).toBe('WEIRD')
})

test('repoLabel keeps group/name without the org; thousands groups digits', () => {
  expect(repoLabel(`${ORG}/frontend/web-app`)).toBe('frontend/web-app')
  expect(repoLabel(`${ORG}/team/backend/search-engine`)).toBe('backend/search-engine')
  expect(repoLabel(`${ORG}/solo`)).toBe('solo')
  expect(thousands(39230)).toBe('39,230')
  expect(thousands(1234567)).toBe('1,234,567')
  expect(thousands(10)).toBe('10')
})

test('branchChecks: open MR shows commits left, how far behind, and that the source branch exists', () => {
  expect(branchChecks(cr(7, 'feat', 'TO_BE_MERGED'), { ahead: 3, behind: 9 }, true)).toEqual([
    { label: '待合入 3 个提交', status: 'pending' },
    { label: '落后 master 9 个提交', status: 'pending' },
    { label: '源分支存在', status: 'pass' },
  ])
  expect(branchChecks(cr(7, 'feat', 'UNDER_REVIEW'), { ahead: 1, behind: 0 }, false)).toEqual([
    { label: '待合入 1 个提交', status: 'pending' },
    { label: '已同步 master', status: 'pass' },
    { label: '源分支已删除', status: 'fail' },
  ])
})

test('branchChecks: merged MR passes once its source branch is deleted; closed MR fails the merge', () => {
  expect(branchChecks(cr(8, 'feat', 'MERGED'), { ahead: 0, behind: 12 }, true)).toEqual([
    { label: '已合入 master', status: 'pass' },
    { label: '源分支未删除', status: 'pending' },
  ])
  expect(branchChecks(cr(8, 'feat', 'MERGED'), undefined, false)).toEqual([
    { label: '已合入 master', status: 'pass' },
    { label: '源分支已删除', status: 'pass' },
  ])
  expect(branchChecks(cr(6, 'feat', 'CLOSED'), undefined, undefined)).toEqual([{ label: '未合入（MR 已关闭）', status: 'fail' }])
})

test('findMrLinks reads Codeup MR pages; isMrCreation recognises the ways an MR is opened', () => {
  expect(findMrLinks(`见 https://codeup.aliyun.com/${ORG}/backend/demo-api/change/205 与 https://codeup.aliyun.com/${ORG}/backend/demo-api/change/206/diffs`))
    .toEqual([{ repoPath: `${ORG}/backend/demo-api`, localId: 205 }, { repoPath: `${ORG}/backend/demo-api`, localId: 206 }])
  expect(findMrLinks(`https://codeup.aliyun.com/${ORG}/backend/demo-api`)).toEqual([])
  expect(isMrCreation('Bash', { command: 'yx codeup-create-change-request --repository-id 1 --source-branch a --target-branch b' })).toBe(true)
  expect(isMrCreation('Bash', { command: 'curl -X POST -H "x" https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/o/repositories/1/changeRequests -d @b.json' })).toBe(true)
  expect(isMrCreation('Bash', { command: 'git push -o merge_request.create origin HEAD' })).toBe(true)
  expect(isMrCreation('Bash', { command: 'curl https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/o/changeRequests?state=all' })).toBe(false)
  expect(isMrCreation('mcp__codeup__create_change_request', {})).toBe(true)
})

test('createdSince keeps the MRs created at or after the call; addPins dedupes', () => {
  const at = Date.parse('2026-10-18T04:15:00Z')
  const list = [
    { ...cr(206, 'b', 'UNDER_REVIEW'), detailUrl: `https://codeup.aliyun.com/${ORG}/backend/demo-api/change/206`, createdAt: '2026-10-18T12:15:20+08:00' },
    { ...cr(204, 'a', 'MERGED'), detailUrl: `https://codeup.aliyun.com/${ORG}/backend/demo-api/change/204`, createdAt: '2026-10-17T00:42:27+08:00' },
  ]
  const pins = createdSince(list, at)
  expect(pins).toEqual([{ repoPath: `${ORG}/backend/demo-api`, localId: 206 }])
  expect(addPins(pins, [...pins, { repoPath: 'x/y', localId: 1 }])).toHaveLength(2)
  // A pin an older version kept for a mere mention (no via) is dropped as soon as the list changes.
  const made = { repoPath: 'x/y', localId: 2, via: 'created' as const }
  expect(addPins([{ repoPath: 'old/mention', localId: 9 }, made], [{ repoPath: 'x/y', localId: 3, via: 'tracked' }]).map(p => p.localId)).toEqual([2, 3])
  expect(shownPins([{ repoPath: 'a/b', localId: 1 }, made])).toEqual([made])
  const many = Array.from({ length: LIST_MAX + 5 }, (_, i) => ({ repoPath: 'x/y', localId: i }))
  expect(addPins([], many).map(p => p.localId).slice(0, 1)).toEqual([5])
  expect(addPins([], many)).toHaveLength(LIST_MAX)
})
