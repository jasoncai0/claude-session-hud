import type { RenderElement } from 'claude-code'

import type { DeployRun } from '../../types'
import type { Settings } from '../settings'
import { ICON_W, ID_W, STATE_W, capRows, cell, foldButton } from '../ui'
import type { Fold, Section, Ui } from '../ui'
import { progressOf, stateOf } from './parse'

/** The 检查 button's column, as wide as the MR rows' so the two line up at the right. */
const CHECKS_W = 12
/** The progress column spans the MR rows' `→ target` columns: the arrow, its gap and the target. */
const ARROW_AND_GAP = 2
const SUMMARY_MAX = 3

export type DeployActions = {
  toggle: (key: string) => void
  dismiss: (key: string) => void
}

export type DeployState = { runs: readonly DeployRun[]; dismissed: readonly string[]; expanded: string | null }

/** A stage's name column in the unfolded list (构建, 部署). */
const STAGE_NAME_W = 6

/**
 * A run unfolded: one line per stage, its glyph and name, then its jobs inline (`✓ 预热发布 · ✕ 灰度人工卡点`), cut to
 * the row's width and whole on hover; the release note first, a `⌃ 收起` last. Kept short so the band rarely scrolls.
 */
function jobList(ui: Ui, r: DeployRun, settings: Settings, act: DeployActions): RenderElement {
  const { Box, Text } = ui
  const stages = r.stages ?? []
  // From the state column to the end of the progress column: the same span the row's name columns take.
  const span = STATE_W + (settings.mrRepo ? settings.mrRepoWidth + 1 : 0) + settings.mrSourceWidth + 1 + settings.mrTargetWidth + ARROW_AND_GAP + 1
  const jobsW = Math.max(10, span - STAGE_NAME_W - 4)
  return (
    <Box key={`deploy-jobs-${r.key}`} flexDirection="column" paddingLeft={ICON_W + ID_W + 2}>
      {r.feature ? (
        <Box key={`deploy-feature-${r.key}`} height={1} overflow="hidden">
          <Text dimColor wrap="truncate-end">发布说明：{r.feature}</Text>
        </Box>
      ) : null}
      {stages.length ? stages.map((st, i) => {
        const s = stateOf(st.status)
        const jobs = st.jobs.map(j => `${stateOf(j.status).glyph} ${j.name}`).join(' · ')
        return (
          <Box key={`deploy-stage-${r.key}-${i}`} height={1} columnGap={1} flexWrap="nowrap" overflow="hidden">
            <Text color={s.tone}>{s.glyph}</Text>
            {cell(ui, { key: `deploy-stage-name-${r.key}-${i}`, text: st.name, width: STAGE_NAME_W, dimColor: true })}
            {cell(ui, { key: `deploy-stage-jobs-${r.key}-${i}`, text: jobs || s.label, width: jobsW })}
          </Box>
        )
      }) : <Text key={`deploy-nojobs-${r.key}`} dimColor>{progressOf(r)}</Text>}
      {foldButton(ui, `deploy-fold-${r.key}`, () => act.toggle(r.key))}
    </Box>
  )
}

/** One release on the MR rows' grid: env under `!id`, the run's state under the MR state, app (the link), branch, progress. */
function row(ui: Ui, r: DeployRun, settings: Settings, isOpen: boolean, act: DeployActions): RenderElement {
  const { Box, Button, Text } = ui
  const s = stateOf(r.error ? undefined : r.status)
  const sum = r.error ? { glyph: '!', tone: 'warning' } : s
  return (
    <Box key={`deploy-${r.key}`} flexDirection="column">
      <Box height={1} flexWrap="nowrap" overflow="hidden" columnGap={1} alignItems="center">
        <Box width={ICON_W} flexShrink={0}><Text color={s.tone}>⇪</Text></Box>
        {cell(ui, { key: `deploy-env-${r.key}`, text: r.env ?? r.stageName ?? '发布', width: ID_W, dimColor: true })}
        {cell(ui, { key: `deploy-state-${r.key}`, text: s.label, width: STATE_W, color: s.tone })}
        {cell(ui, { key: `deploy-app-${r.key}`, text: r.app, width: settings.mrRepoWidth, href: r.url })}
        {cell(ui, { key: `deploy-branch-${r.key}`, text: r.branch ?? r.stageName ?? '', width: settings.mrSourceWidth, mode: 'middle', dimColor: true })}
        {cell(ui, { key: `deploy-progress-${r.key}`, text: progressOf(r), width: settings.mrTargetWidth + ARROW_AND_GAP, color: r.error ? 'warning' : undefined, dimColor: !r.error })}
        <Box flexGrow={1} />
        <Box key={`deploy-checks-${r.key}`} minWidth={CHECKS_W} flexShrink={0}>
          <Button key={`deploy-check-${r.key}`} onPress={() => act.toggle(r.key)}>
            <Text color={sum.tone}>{sum.glyph}</Text> 检查 {isOpen ? '⌃' : '⌄'}
          </Button>
        </Box>
        <Button key={`deploy-dismiss-${r.key}`} role="dismiss" plain label="×" dimColor onPress={() => act.dismiss(r.key)} />
      </Box>
      {isOpen ? jobList(ui, r, settings, act) : null}
    </Box>
  )
}

/** `/deploys` output: one markdown line per release, linked. */
export function deployList(runs: readonly DeployRun[]): string {
  const lines = runs.map(r => {
    const s = stateOf(r.status)
    const where = [r.env, r.branch && `\`${r.branch}\``].filter(Boolean).join(' · ')
    return `- ${s.glyph} **${r.app}**${r.isTracked ? '（跟踪）' : ''} ${where} · ${s.label}${r.number ? ` #${r.number}` : ''} · [AppStack](${r.url}) · ${progressOf(r)}`
  })
  return lines.length ? lines.join('\n') : '本会话还没有触发或跟踪云效发布。跟踪已有发布：`/deploys <AppStack 阶段链接>`，或在消息里贴该链接。'
}

/** One row per release the session triggered, newest first; null with none. */
export function deploySection(ui: Ui, state: DeployState, settings: Settings, act: DeployActions, fold: Fold): Section | null {
  const runs = state.runs.filter(r => !state.dismissed.includes(r.key))
  if (!runs.length) return null
  const { Box, Text } = ui
  const rows = runs.map(r => row(ui, r, settings, state.expanded === r.key, act))
  const shown = runs.slice(0, SUMMARY_MAX)
  return {
    rows: capRows(ui, 'deploy', rows, settings.deployMaxRows, '次发布', fold),
    summary: [
      ...shown.map(r => {
        const s = stateOf(r.status)
        return (
          <Box key={`deploy-sum-${r.key}`} columnGap={1} flexShrink={0}>
            <Text color={s.tone}>⇪{r.app}{r.env ? `·${r.env}` : ''}</Text>
            <Text color={s.tone}>{s.glyph}</Text>
          </Box>
        )
      }),
      ...(runs.length > shown.length ? [<Text key="deploy-sum-more" dimColor>+{runs.length - shown.length}</Text>] : []),
    ],
  }
}
