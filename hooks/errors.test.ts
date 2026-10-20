import { expect, test } from 'claude-code/testing'

import { shortError } from './errors'

test('shortError names network, auth and missing-resource failures; leaves our own messages alone', () => {
  expect(shortError('Post "https://api.github.com/graphql": net/http: TLS handshake timeout')).toEqual({ reason: '网络超时', isTransient: true })
  expect(shortError('dial tcp: lookup api.github.com: no such host')).toEqual({ reason: '网络不可达', isTransient: true })
  expect(shortError('Codeup 502: <html>')).toEqual({ reason: '服务端出错', isTransient: true })
  expect(shortError('API rate limit exceeded for user')).toEqual({ reason: '触发限流', isTransient: true })
  expect(shortError('Flow 401: {"errorCode":"Unauthorized"}')).toEqual({ reason: '未登录或凭证失效', isTransient: false })
  expect(shortError('AppStack 403: forbidden')).toEqual({ reason: '无权限', isTransient: false })
  expect(shortError('Could not resolve to a Repository with the name o/r.')).toEqual({ reason: '不存在或无权限', isTransient: false })
  expect(shortError('未找到 gh CLI（安装后执行 gh auth login）').reason).toBe('未找到 gh CLI（安装后执行 gh auth login）')
  expect(shortError('未找到云效 token（设置 ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN）')).toEqual({ reason: '未找到云效 token（设置 ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN）', isTransient: false })
})
