import type { Color, Elements, RenderElement } from 'claude-code'

import { fit } from './text'
import type { FitMode } from './text'

/** Any surface's element table; Box, Text, Button and Link exist on every one. */
export type Ui = Elements[keyof Elements]

/**
 * The leading columns every module row shares, in cells, so MR and document rows line up: a glyph, an id-like column
 * (`!383`, a document's kind) and a state chip (已合并, 创建 / 提及).
 */
export const ICON_W = 2
export const ID_W = 6
export const STATE_W = 6
/** The fold toggle's column, to the left of every row. */
export const TOGGLE_W = 2
export const DISMISS_W = 1

/** What a module draws in the band: its rows unfolded, and its part of the one-line summary folded. */
export type Section = { rows: RenderElement[]; summary: RenderElement[] }

export type CellSpec = {
  /** Unique among its siblings: the hover scope's address. */
  key: string
  text: string
  /** Cells the column takes, whatever the text's length. */
  width: number
  mode?: FitMode
  color?: Color
  dimColor?: boolean
  bold?: boolean
  align?: 'left' | 'right'
  /** Makes the shown text a link. */
  href?: string
}

/**
 * A fixed-width column: the text cut with an ellipsis to fit, and when cut, the full text painted over the row
 * while the pointer is on it (absolute, so nothing reflows).
 */
export function cell(ui: Ui, spec: CellSpec): RenderElement {
  const { Box, Link, Text } = ui
  const shown = fit(spec.text, spec.width, spec.mode)
  const isCut = shown !== spec.text
  return (
    <Box key={spec.key} width={spec.width} flexShrink={0}>
      <Box width={spec.width} overflow="hidden" justifyContent={spec.align === 'right' ? 'flex-end' : 'flex-start'}>
        {spec.href ? (
          <Link href={spec.href} label={shown} />
        ) : (
          <Text color={spec.color} dimColor={spec.dimColor} bold={spec.bold} wrap="truncate-end">{shown}</Text>
        )}
      </Box>
      {isCut ? (
        <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }}>
          <Text inverse>{spec.text}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** A blank column the width of `width`, so rows without a control stay aligned with rows that have one. */
export const gap = (ui: Ui, key: string, width: number): RenderElement => <ui.Box key={key} width={width} flexShrink={0} />

/**
 * The `⌃ 收起` line closing an unfolded detail list: the fold is in reach where the list ends, even when a tall band
 * has scrolled the row's own button out of view.
 */
export const foldButton = (ui: Ui, key: string, onPress: () => void): RenderElement => (
  <ui.Box key={`${key}-box`} height={1}>
    <ui.Button key={key} plain dimColor label="⌃ 收起" onPress={onPress} />
  </ui.Box>
)

/** Whether a list shows past its row cap, and the press that flips it. */
export type Fold = { isExpanded: boolean; toggle: () => void }

/**
 * At most `max` rows: past it, the first `max - 1` and a `⌄ 展开另 N <noun>` button in the last row; unfolded, every
 * row and a `⌃ 收起` button. The rows unfold in place: nothing to type.
 */
export function capRows(ui: Ui, key: string, rows: readonly RenderElement[], max: number, noun: string, fold: Fold): RenderElement[] {
  if (rows.length <= max) return [...rows]
  const button = (label: string) => (
    <ui.Box key={`${key}-fold`} height={1}>
      <ui.Button key={`${key}-more`} plain dimColor label={label} onPress={fold.toggle} />
    </ui.Box>
  )
  if (fold.isExpanded) return [...rows, button('⌃ 收起')]
  const kept = rows.slice(0, Math.max(0, max - 1))
  return [...kept, button(`⌄ 展开另 ${rows.length - kept.length} ${noun}`)]
}
