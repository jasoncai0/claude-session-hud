import type { RenderElement } from 'claude-code'

import { DEFAULTS, MODULE_IDS, isSettingKey, parseSetting } from './settings'
import type { SettingKey, Settings } from './settings'
import { TOGGLE_W, gap } from './ui'
import type { Section, Ui } from './ui'

const MODULE_NAMES: Record<string, string> = { usage: '用量', mr: 'MR / PR', docs: '飞书文档', deploy: '云效发布' }

export const HELP = [
  '用法（`/hud` 与其他插件重名时为 `/session-hud`，其余命令同理：`/session-mr` 等）：',
  '- `/hud` 查看各模块开关与配置',
  '- `/hud usage|mr|docs|deploy on|off` 启停模块（写入插件配置，立即生效）',
  '- `/hud fold` / `/hud unfold` 折叠 / 展开本会话的 HUD（默认值：`/hud set collapsed on|off`）',
  '- `/hud set <配置项> <值>` 改任一配置，如 `/hud set mrSourceWidth 30`',
].join('\n')

/** `/hud` with no arguments: each module's switch, then every other setting. */
export function status(settings: Settings, isCollapsed: boolean): string {
  const modules = MODULE_IDS.map(id => `- ${MODULE_NAMES[id]} \`${id}\`：${settings[id] ? '开' : '关'}`)
  const rest = (Object.keys(DEFAULTS) as SettingKey[])
    .filter(k => !(MODULE_IDS as readonly string[]).includes(k))
    .map(k => `\`${k}\`=${String(settings[k])}`)
  return [`**session-hud**（${isCollapsed ? '已折叠' : '已展开'}）`, ...modules, `配置：${rest.join(' · ')}`, '', HELP].join('\n')
}

export type HudCommand =
  | { kind: 'status' }
  | { kind: 'fold'; isCollapsed: boolean }
  | { kind: 'set'; key: SettingKey; value: boolean | number }
  | { kind: 'reply'; text: string }

/** `/hud` arguments → what to do. */
export function parseHud(args: string): HudCommand {
  const [first = '', second = '', third = ''] = args.trim().split(/\s+/)
  if (!first) return { kind: 'status' }
  if (first === 'fold' || first === 'unfold') return { kind: 'fold', isCollapsed: first === 'fold' }
  const [key, text] = first === 'set' ? [second, third] : [first, second]
  const isModule = (MODULE_IDS as readonly string[]).includes(first)
  if (!isModule && first !== 'set') return { kind: 'reply', text: HELP }
  if (!isSettingKey(key)) return { kind: 'reply', text: `没有配置项 \`${key}\`\n\n${HELP}` }
  const parsed = parseSetting(key, text)
  return 'error' in parsed ? { kind: 'reply', text: parsed.error } : { kind: 'set', key, value: parsed.value }
}

/**
 * The band: every enabled module's rows under one fold toggle, or folded, one summary row. Without `onToggle` it is the
 * summary alone with no control in it: what shows above a card holding the band, which owns the keys and clicks there.
 */
export function band(ui: Ui, sections: readonly Section[], isCollapsed: boolean, onToggle?: () => void, isNativeButton = false): RenderElement {
  const { Box, Button, Text } = ui
  // A desktop draws every Button as its native button (Claude Code 2.1.308 on): one in the 2-cell column loses its
  // glyph to the padding, so there the same glyph sits at the end of the first row.
  if (isNativeButton && onToggle) return nativeBand(ui, sections, isCollapsed, onToggle)
  const toggle = onToggle ? (
    <Box key="hud-toggle" width={TOGGLE_W} flexShrink={0}>
      <Button key="hud-fold" plain dimColor label={isCollapsed ? '▸' : '▾'} onPress={onToggle} />
    </Box>
  ) : gap(ui, 'hud-toggle', TOGGLE_W)
  if (isCollapsed) {
    const parts = sections.flatMap((s, i) => (i === 0 ? s.summary : [<Text key={`hud-sep-${i}`} dimColor>·</Text>, ...s.summary]))
    return (
      <Box key="hud" height={1} flexWrap="nowrap" overflow="hidden" columnGap={1}>
        {toggle}
        {parts}
      </Box>
    )
  }
  const rows = sections.flatMap(s => s.rows)
  return (
    <Box key="hud" flexDirection="column">
      {rows.map((r, i) => (
        <Box key={`hud-row-${i}`} flexDirection="row">
          {i === 0 ? toggle : gap(ui, `hud-pad-${i}`, TOGGLE_W)}
          <Box flexGrow={1} flexDirection="column">{r}</Box>
        </Box>
      ))}
    </Box>
  )
}

/** The band where Buttons are native: the same rows, the fold's `▾` / `▸` button closing the first row. */
function nativeBand(ui: Ui, sections: readonly Section[], isCollapsed: boolean, onToggle: () => void): RenderElement {
  const { Box, Button, Text } = ui
  const toggle = (
    <Box key="hud-toggle" flexShrink={0}>
      <Button key="hud-fold" dimColor label={isCollapsed ? '▸' : '▾'} onPress={onToggle} />
    </Box>
  )
  if (isCollapsed) {
    const parts = sections.flatMap((s, i) => (i === 0 ? s.summary : [<Text key={`hud-sep-${i}`} dimColor>·</Text>, ...s.summary]))
    return (
      <Box key="hud" height={1} flexWrap="nowrap">
        {gap(ui, 'hud-pad', TOGGLE_W)}
        <Box flexGrow={1} flexWrap="nowrap" overflow="hidden" columnGap={1}>{parts}</Box>
        {toggle}
      </Box>
    )
  }
  const rows = sections.flatMap(s => s.rows)
  return (
    <Box key="hud" flexDirection="column">
      {rows.map((r, i) => (
        <Box key={`hud-row-${i}`} flexDirection="row">
          {gap(ui, `hud-pad-${i}`, TOGGLE_W)}
          <Box flexGrow={1} flexDirection="column">{r}</Box>
          {i === 0 ? toggle : null}
        </Box>
      ))}
    </Box>
  )
}
