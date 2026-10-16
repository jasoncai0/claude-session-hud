import type { RenderElement } from 'claude-code'

import type { DocLink, DocOrigin } from '../../types'
import type { Settings } from '../settings'
import { DISMISS_W, ICON_W, ID_W, STATE_W, TOGGLE_W, capRows, cell } from '../ui'
import type { Fold, Section, Ui } from '../ui'
import { KIND_LABELS } from './links'

const TOKEN_SHOWN = 8

/** The document's state chip: what the session made stands out, what it only mentioned is dim. */
const ORIGINS: Record<DocOrigin, { label: string; tone?: string; isDim?: boolean }> = {
  created: { label: '创建', tone: 'success' },
  mentioned: { label: '提及', isDim: true },
}

const GLYPHS: Record<string, string> = { wiki: '◈', sheets: '▦', sheet: '▦', base: '▥', bitable: '▥', slides: '▭', mindnotes: '◎', mindnote: '◎', file: '▢' }

const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind

/** The title; until it is known, the link text it was seen with, else the kind and the token's head. */
export const docTitle = (d: DocLink) => d.title ?? d.label ?? `${kindLabel(d.kind)} ${d.token.slice(0, TOKEN_SHOWN)}…`

/** Cells a doc row takes besides its title: glyph, kind, origin, ×, the five gaps between, and the fold toggle. */
const ROW_OVERHEAD = ICON_W + ID_W + STATE_W + DISMISS_W + 5 + TOGGLE_W
const MIN_TITLE_W = 10

/** The settings with the title column narrowed to what `bodyColumns` leaves, so the row's controls stay on screen. */
export const docsLayout = (settings: Settings, bodyColumns: number): Settings => ({
  ...settings,
  docsTitleWidth: Math.max(MIN_TITLE_W, Math.min(settings.docsTitleWidth, bodyColumns - ROW_OVERHEAD)),
})

/** The documents the band shows: not dismissed, and mentions only while `docsMentioned` is on. */
export const visibleDocs = (list: readonly DocLink[], dismissed: readonly string[], settings: Settings): DocLink[] =>
  list.filter(d => !dismissed.includes(d.token) && (settings.docsMentioned || d.origin === 'created'))

/** `/docs` output: one markdown line per document, linked. */
export function docList(list: readonly DocLink[]): string {
  const lines = list.map(d => `- ${ORIGINS[d.origin].label} · ${kindLabel(d.kind)} · [${docTitle(d)}](${d.url})`)
  return lines.length ? lines.join('\n') : '本会话还没有创建或提到飞书文档。'
}

/**
 * One document on the MR rows' grid: glyph, kind under `!id`, 创建 / 提及 under the MR state, then the title, which is
 * the link (cut to its column, whole on hover).
 */
function row(ui: Ui, d: DocLink, settings: Settings, dismiss: (token: string) => void): RenderElement {
  const { Box, Button, Text } = ui
  const o = ORIGINS[d.origin]
  return (
    <Box key={`doc-${d.token}`} height={1} flexWrap="nowrap" overflow="hidden" columnGap={1} alignItems="center">
      <Box width={ICON_W} flexShrink={0}><Text color="suggestion">{GLYPHS[d.kind] ?? '▤'}</Text></Box>
      {cell(ui, { key: `doc-kind-${d.token}`, text: kindLabel(d.kind), width: ID_W, dimColor: true })}
      {cell(ui, { key: `doc-origin-${d.token}`, text: o.label, width: STATE_W, color: o.tone, dimColor: o.isDim })}
      {cell(ui, { key: `doc-title-${d.token}`, text: docTitle(d), width: settings.docsTitleWidth, href: d.url })}
      <Box flexGrow={1} />
      <Button key={`doc-dismiss-${d.token}`} role="dismiss" plain label="×" dimColor onPress={() => dismiss(d.token)} />
    </Box>
  )
}

/** One row per document, newest first, capped at `docsMaxRows`; null with none. */
export function docsSection(ui: Ui, list: readonly DocLink[], settings: Settings, dismiss: (token: string) => void, fold: Fold): Section | null {
  if (!list.length) return null
  const { Box, Text } = ui
  const created = list.filter(d => d.origin === 'created').length
  return {
    rows: capRows(ui, 'docs', list.map(d => row(ui, d, settings, dismiss)), settings.docsMaxRows, '篇文档', fold),
    summary: [
      <Box key="docs-sum" columnGap={1} flexShrink={0}>
        <Text color="suggestion">▤</Text>
        <Text>文档 {list.length}</Text>
        {created ? <Text dimColor>(创建 {created})</Text> : null}
      </Box>,
    ],
  }
}
