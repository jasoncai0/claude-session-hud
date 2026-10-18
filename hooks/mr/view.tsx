import type { RenderElement } from 'claude-code'

import type { MrView, SessionView } from '../../types'
import type { Settings } from '../settings'
import { DISMISS_W, ICON_W, ID_W, STATE_W, TOGGLE_W, capRows, cell, gap } from '../ui'
import type { Fold, Section, Ui } from '../ui'
import { CHECK_GLYPH, prIcon, stateOf, summarize, thousands } from './codeup'
import { mrKey, mrRef } from './session'

/** Fixed column widths, in cells: every MR row lines up whatever its id, state or numbers. */
const STATS_W = 16
const CHECKS_W = 12
const SUMMARY_MAX = 3
const ARROW_W = 1
const MIN_COL_W = 6

/**
 * The settings with the repo / source / target columns narrowed to what `bodyColumns` leaves after the fixed columns,
 * in proportion and no narrower than MIN_COL_W; the repo column is dropped when even that does not fit. So the row's
 * controls (checks, ×) stay on screen in a narrow terminal, and every row still has the same columns.
 */
export function mrLayout(settings: Settings, bodyColumns: number): Settings {
  const fixed = [ICON_W, ID_W, STATE_W, ARROW_W, settings.mrStats ? STATS_W : 0, settings.mrChecks ? CHECKS_W : 0, DISMISS_W].filter(w => w > 0)
  const spacer = 1
  const fit = (withRepo: boolean): Settings | null => {
    const widths = withRepo ? [settings.mrRepoWidth, settings.mrSourceWidth, settings.mrTargetWidth] : [0, settings.mrSourceWidth, settings.mrTargetWidth]
    const columns = fixed.length + widths.filter(w => w > 0).length + spacer
    const room = bodyColumns - TOGGLE_W - fixed.reduce((a, b) => a + b, 0) - (columns - 1)
    const wanted = widths.reduce((a, b) => a + b, 0)
    const scale = Math.min(1, room / wanted)
    const [repo = 0, src = 0, tgt = 0] = widths.map(w => (w > 0 ? Math.max(MIN_COL_W, Math.floor(w * scale)) : 0))
    if (repo + src + tgt > room) return null
    return { ...settings, mrRepo: withRepo, mrRepoWidth: repo || settings.mrRepoWidth, mrSourceWidth: src, mrTargetWidth: tgt }
  }
  return (settings.mrRepo ? fit(true) : null) ?? fit(false) ?? { ...settings, mrRepo: false, mrSourceWidth: MIN_COL_W, mrTargetWidth: MIN_COL_W }
}

export type MrActions = {
  toggleChecks: (key: string) => void
  dismiss: (key: string) => void
}

export type MrState = { view: SessionView | null; dismissed: readonly string[]; expanded: string | null }

/**
 * The state-coloured MR glyph. On the terminal it links to the MR like the `!id` beside it; a desktop draws it as an
 * Svg, which no link may hold, so there the `!id` is the link.
 */
const icon = (ui: Ui, mr: MrView): RenderElement => {
  const s = stateOf(mr.state)
  if ('Svg' in ui) return <ui.Svg source={prIcon(s.hex)} alt={s.label} width={16} height={16} />
  return <ui.Link href={mr.url}><ui.Text color={s.tone}>⑂</ui.Text></ui.Link>
}

function statsCell(ui: Ui, mr: MrView): RenderElement {
  const { Box, Text } = ui
  const key = `mr-stats-${mrKey(mr)}`
  if (mr.additions === undefined || mr.deletions === undefined) return gap(ui, key, STATS_W)
  return (
    <Box key={key} width={STATS_W} flexShrink={0} justifyContent="flex-end" columnGap={1}>
      <Text color="diffAdded" bold>+{thousands(mr.additions)}</Text>
      <Text color="diffRemoved" bold>-{thousands(mr.deletions)}</Text>
    </Box>
  )
}

function checksCell(ui: Ui, mr: MrView, isOpen: boolean, act: MrActions): RenderElement {
  const { Box, Button, Text } = ui
  const key = mrKey(mr)
  const sum = CHECK_GLYPH[summarize(mr.checks)]
  return (
    <Box key={`mr-checks-${key}`} minWidth={CHECKS_W} flexShrink={0}>
      {mr.checks.length ? (
        <Button key={`checks-${key}`} onPress={() => act.toggleChecks(key)}>
          <Text color={sum.tone}>{sum.glyph}</Text> 检查 {isOpen ? '⌃' : '⌄'}
        </Button>
      ) : null}
    </Box>
  )
}

function checksList(ui: Ui, mr: MrView): RenderElement {
  const { Box, Text } = ui
  const key = mrKey(mr)
  return (
    <Box key={`mr-checklist-${key}`} flexDirection="column" paddingLeft={ICON_W + ID_W + 2}>
      {mr.checks.map(c => {
        const g = CHECK_GLYPH[c.status]
        return (
          <Box key={`check-${key}-${c.label}`} height={1} columnGap={1}>
            <Text color={g.tone}>{g.glyph}</Text>
            <Text wrap="truncate-end">{c.label}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** One MR: a single fixed-height line of fixed-width columns (long names cut, full on hover), checks unfolded below. */
function row(ui: Ui, mr: MrView, settings: Settings, isOpen: boolean, act: MrActions): RenderElement {
  const { Box, Button, Link, Text } = ui
  const key = mrKey(mr)
  const s = stateOf(mr.state)
  return (
    <Box key={`mr-${key}`} flexDirection="column">
      <Box height={1} flexWrap="nowrap" overflow="hidden" columnGap={1} alignItems="center">
        <Box width={ICON_W} flexShrink={0}>{icon(ui, mr)}</Box>
        <Box width={ID_W} flexShrink={0}><Link href={mr.url} label={mrRef(mr)} /></Box>
        {cell(ui, { key: `mr-state-${key}`, text: s.label, width: STATE_W, color: s.tone })}
        {settings.mrRepo ? cell(ui, { key: `mr-repo-${key}`, text: mr.repo, width: settings.mrRepoWidth, dimColor: true }) : null}
        {cell(ui, { key: `mr-src-${key}`, text: mr.source, width: settings.mrSourceWidth, mode: 'middle', dimColor: true })}
        <Text dimColor>→</Text>
        {cell(ui, { key: `mr-tgt-${key}`, text: mr.target, width: settings.mrTargetWidth, mode: 'middle', dimColor: true })}
        <Box flexGrow={1} />
        {settings.mrStats ? statsCell(ui, mr) : null}
        {settings.mrChecks ? checksCell(ui, mr, isOpen, act) : null}
        <Button key={`dismiss-${key}`} role="dismiss" plain label="×" dimColor onPress={() => act.dismiss(key)} />
      </Box>
      {isOpen && settings.mrChecks ? checksList(ui, mr) : null}
    </Box>
  )
}

function summary(ui: Ui, mrs: readonly MrView[]): RenderElement[] {
  const { Box, Text } = ui
  if (!mrs.length) return [<Text key="mr-sum-err" color="warning">⑂ !</Text>]
  const shown = mrs.slice(0, SUMMARY_MAX).map(mr => {
    const sum = CHECK_GLYPH[summarize(mr.checks)]
    return (
      <Box key={`mr-sum-${mrKey(mr)}`} columnGap={1} flexShrink={0}>
        <Text color={stateOf(mr.state).tone}>⑂{mrRef(mr)}</Text>
        {mr.checks.length ? <Text color={sum.tone}>{sum.glyph}</Text> : null}
      </Box>
    )
  })
  const rest = mrs.length - shown.length
  return rest > 0 ? [...shown, <Text key="mr-sum-more" dimColor>+{rest}</Text>] : shown
}

/** The MR rows of the session's repos, dismissed ones left out; null with nothing to show. */
export function mrSection(ui: Ui, state: MrState, settings: Settings, act: MrActions, fold: Fold): Section | null {
  const v = state.view
  if (!v) return null
  const mrs = v.repos.flatMap(r => r.mrs).filter(mr => !state.dismissed.includes(mrKey(mr)))
  const errors = v.error ? [v.error] : v.repos.flatMap(r => (r.error ? [`${r.repo}: ${r.error}`] : []))
  if (!mrs.length && !errors.length) return null
  const { Box, Text } = ui
  const rows = mrs.map(mr => row(ui, mr, settings, state.expanded === mrKey(mr), act))
  const errorRows = errors.map(err => (
    <Box key={`mr-err-${err}`} height={1} overflow="hidden">
      <Text dimColor wrap="truncate-end">Codeup MR · {err}</Text>
    </Box>
  ))
  return {
    rows: [...capRows(ui, 'mr', rows, settings.mrMaxRows, '个 MR', fold), ...errorRows],
    summary: summary(ui, mrs),
  }
}
