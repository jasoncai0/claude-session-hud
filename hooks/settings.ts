import type { PluginOptions } from 'claude-code'

export const PLUGIN = 'session-hud'

/** How many items a module keeps per session (repos, MRs, docs, releases): rows past `*MaxRows` fold, so this is only a safety cap. */
export const LIST_MAX = 100

export const MODULE_IDS = ['usage', 'mr', 'docs', 'deploy'] as const
export type ModuleId = (typeof MODULE_IDS)[number]

/** Every userConfig field but the token, with its default: the one place defaults live in code. */
export const DEFAULTS = {
  usage: true,
  mr: true,
  docs: true,
  deploy: true,
  collapsed: false,
  usageReset: true,
  mrMaxRows: 3,
  mrRepo: true,
  mrRepoWidth: 18,
  mrSourceWidth: 24,
  mrTargetWidth: 16,
  mrStats: true,
  mrChecks: true,
  mrPollSeconds: 60,
  docsMaxRows: 3,
  docsTitleWidth: 40,
  docsMentioned: true,
  docsArtifacts: true,
  deployMaxRows: 3,
  deployPollSeconds: 30,
} as const

export type SettingKey = keyof typeof DEFAULTS
export type Settings = { -readonly [K in SettingKey]: (typeof DEFAULTS)[K] extends boolean ? boolean : number } & { token?: string }

/** Inclusive bounds for the numeric fields; a value outside is clamped. */
const RANGES: Partial<Record<SettingKey, readonly [number, number]>> = {
  mrMaxRows: [1, 10],
  mrRepoWidth: [6, 60],
  mrSourceWidth: [6, 80],
  mrTargetWidth: [6, 60],
  mrPollSeconds: [15, 3600],
  docsMaxRows: [1, 10],
  docsTitleWidth: [10, 120],
  deployMaxRows: [1, 10],
  deployPollSeconds: [10, 600],
}

const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Math.round(n)))

export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(DEFAULTS, key)

/** The plugin's options, typed: unknown or mistyped values fall back to the default. */
export function settingsOf(options: PluginOptions): Settings {
  const entries = (Object.keys(DEFAULTS) as SettingKey[]).map(key => {
    const fallback = DEFAULTS[key]
    const raw = options[key]
    if (typeof fallback === 'boolean') return [key, typeof raw === 'boolean' ? raw : fallback]
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    const range = RANGES[key]
    return [key, Number.isFinite(n) ? (range ? clamp(n, range) : n) : fallback]
  })
  const token = typeof options.token === 'string' && options.token ? options.token : undefined
  return { ...(Object.fromEntries(entries) as Settings), ...(token ? { token } : {}) }
}

/** `/hud set <key> <value>` text → the value the field takes, or an error. */
export function parseSetting(key: SettingKey, text: string): { value: boolean | number } | { error: string } {
  if (typeof DEFAULTS[key] === 'boolean') {
    if (/^(on|true|1|yes|开)$/i.test(text)) return { value: true }
    if (/^(off|false|0|no|关)$/i.test(text)) return { value: false }
    return { error: `${key} 取值 on / off` }
  }
  const n = Number(text)
  if (!text || !Number.isFinite(n)) return { error: `${key} 取值为数字` }
  const range = RANGES[key]
  return { value: range ? clamp(n, range) : n }
}
