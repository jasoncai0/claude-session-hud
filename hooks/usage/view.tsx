import type { Usage } from '../../types'
import type { Settings } from '../settings'
import type { Section, Ui } from '../ui'
import { meters } from './format'

/** One row of bars per fresh rate-limit window; null with no fresh reading. */
export function usageSection(ui: Ui, u: Usage | null, now: number, settings: Settings): Section | null {
  const rows = u ? meters(u, now) : []
  if (!rows.length) return null
  const { Box, Text } = ui
  return {
    rows: [
      <Box key="usage" height={1} flexWrap="nowrap" overflow="hidden" columnGap={2}>
        {rows.map(m => (
          <Box key={`usage-${m.label}`} columnGap={1} flexShrink={0}>
            <Text dimColor>{m.label}</Text>
            <Text color={m.level}>{m.bar}</Text>
            <Text color={m.level}>{m.percent}</Text>
            {settings.usageReset && m.reset ? <Text dimColor>{m.reset}</Text> : null}
          </Box>
        ))}
      </Box>,
    ],
    summary: rows.map(m => (
      <Box key={`usage-sum-${m.label}`} columnGap={1} flexShrink={0}>
        <Text dimColor>{m.label}</Text>
        <Text color={m.level}>{m.percent}</Text>
      </Box>
    )),
  }
}
