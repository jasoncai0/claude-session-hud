import { expect, test } from 'claude-code/testing'

import type { MrView, RepoView } from '../../types'
import { LIST_MAX } from '../settings'
import { dirsOf, mrList, rememberDirs } from './session'

const mr = (repo: string, id: number, state: string, fail = false): MrView => ({
  id, repo, state, url: `https://codeup.aliyun.com/o/${repo}/change/${id}`, title: `t${id}`, source: 'feat', target: 'master',
  checks: fail ? [{ label: 'x', status: 'fail' }] : [],
})
const repo = (name: string, mrs: MrView[]): RepoView => ({ root: `/w/${name}`, repo: name, branch: 'feat', mrs })


test('dirsOf reads edited files and Bash cd / git -C targets', () => {
  expect(dirsOf('Edit', { file_path: '/w/demo-api/src/A.java' }, '/Users/me')).toEqual(['/w/demo-api/src'])
  expect(dirsOf('Read', { file_path: '/w/demo-api/src/A.java' }, '/Users/me')).toEqual([])
  expect(dirsOf('Bash', { command: 'cd ~/workspace/billing-svc && git push; git -C "/w/a b" status' }, '/Users/me'))
    .toEqual(['/Users/me/workspace/billing-svc', '/w/a b'])
  expect(dirsOf('Bash', { command: 'cd relative && ls' }, '/Users/me')).toEqual([])
})

test('rememberDirs dedupes, keeps newest last, caps at LIST_MAX (100)', () => {
  expect(rememberDirs(['/a', '/b'], ['/a'])).toEqual(['/b', '/a'])
  expect(rememberDirs(Array.from({ length: LIST_MAX }, (_, i) => `/${i}`), ['/new'])).toHaveLength(LIST_MAX)
})

test('mrList renders linked markdown lines', () => {
  expect(mrList([repo('demo-api', [mr('demo-api', 191, 'TO_BE_MERGED')])], () => '待合并'))
    .toBe('- 🔀 **demo-api** [!191 t191](https://codeup.aliyun.com/o/demo-api/change/191) · 待合并 · `feat` → `master`')
  expect(mrList([], () => '')).toContain('没有 MR')
})
