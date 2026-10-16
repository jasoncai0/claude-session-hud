import type { RenderElement } from 'claude-code'

type Node = RenderElement | string | number | boolean | null | undefined

// True when a tree would draw nothing visible: no node, blank text, or Box/Text holding only such.
export const isBlank = (node: Node): boolean => {
  if (node === null || node === undefined || typeof node === 'boolean') return true
  if (typeof node === 'string') return node.trim() === ''
  if (typeof node === 'number') return false
  if (node.type !== 'Box' && node.type !== 'Text') return false
  const children = ((node as { children?: Node[] }).children ?? []) as Node[]
  return children.every(isBlank)
}
