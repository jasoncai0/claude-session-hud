import { expect, test } from 'claude-code/testing'

import type { ApiPr } from './github'
import { compareRange, findPrLinks, parseGithubRemote, pickPrs, prChecks, prQuery, prState, prView, prsOf } from './github'

const pr = (over: Partial<ApiPr> = {}): ApiPr => ({
  number: 7, url: 'https://github.com/acme/gh-app/pull/7', title: 't7', state: 'OPEN', isDraft: false, merged: false,
  additions: 12, deletions: 3, headRefName: 'feat', baseRefName: 'main', headRef: { name: 'feat' }, headRepositoryOwner: { login: 'acme' },
  mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
  commits: { totalCount: 2, nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'StatusContext', context: 'lint', state: 'SUCCESS' },
  ] } } } }] },
  reviewThreads: { nodes: [{ isResolved: true }] },
  ...over,
})

test('parseGithubRemote reads ssh and https remotes and rejects others', () => {
  expect(parseGithubRemote('git@github.com:acme/gh-app.git\n')).toEqual({ owner: 'acme', name: 'gh-app' })
  expect(parseGithubRemote('https://github.com/acme/gh-app')).toEqual({ owner: 'acme', name: 'gh-app' })
  expect(parseGithubRemote('ssh://git@github.com/acme/gh-app.git')).toEqual({ owner: 'acme', name: 'gh-app' })
  expect(parseGithubRemote('git@codeup.aliyun.com:org/a/b.git')).toBe(null)
})

test('findPrLinks pins GitHub PR pages, deduped', () => {
  expect(findPrLinks('see https://github.com/acme/gh-app/pull/7 and https://github.com/acme/gh-app/pull/7/files, https://github.com/acme/gh-app/issues/8'))
    .toEqual([{ repoPath: 'acme/gh-app', localId: 7, forge: 'github' }])
})

test('prQuery quotes names as GraphQL strings and aliases pinned numbers', () => {
  const q = prQuery({ owner: 'acme', name: 'gh-app' }, 'feat/"x"', [7, 9])
  expect(q).toContain('repository(owner: "acme", name: "gh-app")')
  expect(q).toContain('headRefName: "feat/\\"x\\""')
  expect(q).toContain('n7: pullRequest(number: 7)')
  expect(q).toContain('n9: pullRequest(number: 9)')
  expect(prQuery({ owner: 'a', name: 'b' }, undefined, [1])).not.toContain('pullRequests(')
})

test('prsOf splits branch and pinned PRs and drops numbers that are no PR', () => {
  const answer = { data: { repository: { branch: { nodes: [pr()] }, n9: pr({ number: 9 }), n10: null } } }
  const { branch, pinned } = prsOf(answer)
  expect(branch.map(p => p.number)).toEqual([7])
  expect(pinned.map(p => p.number)).toEqual([9])
  expect(prsOf(null)).toEqual({ branch: [], pinned: [] })
})

test('pickPrs prefers open PRs, else the latest closed one; prState maps to the MR vocabulary', () => {
  expect(pickPrs([pr({ number: 3, state: 'MERGED' }), pr({ number: 4 })]).map(p => p.number)).toEqual([4])
  expect(pickPrs([pr({ number: 3, state: 'MERGED' }), pr({ number: 2, state: 'CLOSED' })]).map(p => p.number)).toEqual([3])
  expect(prState(pr())).toBe('TO_BE_MERGED')
  expect(prState(pr({ reviewDecision: 'REVIEW_REQUIRED' }))).toBe('UNDER_REVIEW')
  expect(prState(pr({ mergeStateStatus: 'BLOCKED' }))).toBe('UNDER_REVIEW')
  expect(prState(pr({ isDraft: true }))).toBe('UNDER_DEV')
  expect(prState(pr({ state: 'MERGED', merged: true }))).toBe('MERGED')
  expect(prState(pr({ state: 'CLOSED' }))).toBe('CLOSED')
})

test('prChecks: an open PR shows commits left, lag, branch, conflicts, CI, review and threads', () => {
  expect(prChecks(pr(), 4)).toEqual([
    { label: '待合入 2 个提交', status: 'pending' },
    { label: '落后 main 4 个提交', status: 'pending' },
    { label: '源分支存在', status: 'pass' },
    { label: '无冲突', status: 'pass' },
    { label: 'CI 通过（2）', status: 'pass' },
    { label: '评审通过', status: 'pass' },
  ])
  const failing = pr({
    mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED', reviewThreads: { nodes: [{ isResolved: false }, { isResolved: false }] },
    commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: null },
    ] } } } }] },
  })
  expect(prChecks(failing, 0).map(c => `${c.status}:${c.label}`)).toEqual([
    'pending:待合入 1 个提交', 'pass:已同步 main', 'pass:源分支存在', 'fail:存在冲突', 'fail:CI 失败：build', 'fail:评审要求修改', 'pending:未解决评论 2',
  ])
  const running = pr({ commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: { state: 'PENDING', contexts: { nodes: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', context: 'ci', state: 'PENDING' },
  ] } } } }] } })
  expect(prChecks(running).find(c => c.label.startsWith('CI'))).toEqual({ label: 'CI 运行中 1/2', status: 'pending' })
})

test('prChecks: a merged PR passes once its branch is deleted; a closed one fails the merge', () => {
  expect(prChecks(pr({ state: 'MERGED', merged: true, headRef: null })).slice(0, 2)).toEqual([
    { label: '已合入 main', status: 'pass' },
    { label: '源分支已删除', status: 'pass' },
  ])
  expect(prChecks(pr({ state: 'CLOSED' }))[0]).toEqual({ label: '未合入（PR 已关闭）', status: 'fail' })
})

test('prView is a #-numbered row with stats; compareRange names a fork head by owner', () => {
  const v = prView(pr(), { owner: 'acme', name: 'gh-app' }, 0)
  expect({ id: v.id, repo: v.repo, forge: v.forge, additions: v.additions, deletions: v.deletions, state: v.state }).toEqual({ id: 7, repo: 'acme/gh-app', forge: 'github', additions: 12, deletions: 3, state: 'TO_BE_MERGED' })
  expect(compareRange(pr({ headRepositoryOwner: { login: 'someone' } }))).toBe('main...someone:feat')
})
