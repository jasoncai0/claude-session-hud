/** A failure as a row shows it: a short reason, and whether the next poll may well clear it. */
export type ShortError = { reason: string; isTransient: boolean }

/** Known failures, first match wins; anything else is shown as it came, cut to its first line. */
const RULES: readonly (readonly [RegExp, string, boolean])[] = [
  [/rate limit|\b429\b/i, '触发限流', true],
  [/timeout|timed out|ETIMEDOUT|deadline exceeded/i, '网络超时', true],
  [/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|no such host|dial tcp|connection (?:reset|refused)|network is unreachable|TLS|certificate/i, '网络不可达', true],
  [/\b5\d\d\b|bad gateway|service unavailable/i, '服务端出错', true],
  [/\b401\b|unauthori[sz]ed|bad credentials|auth login/i, '未登录或凭证失效', false],
  [/\b403\b|forbidden/i, '无权限', false],
  [/\b404\b|not found|could not resolve to a/i, '不存在或无权限', false],
]
const MAX_RAW = 60

/** The plugin's own messages (未找到 gh CLI…) already say what to do. */
const OWN_MESSAGE_RE = /^[\u4e00-\u9fff]/

export function shortError(message: string): ShortError {
  if (OWN_MESSAGE_RE.test(message)) return { reason: message, isTransient: false }
  const rule = RULES.find(([re]) => re.test(message))
  if (rule) return { reason: rule[1], isTransient: rule[2] }
  const line = message.trim().split('\n')[0] ?? ''
  return { reason: line.length > MAX_RAW ? `${line.slice(0, MAX_RAW)}…` : line, isTransient: false }
}
