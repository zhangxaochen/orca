import {
  TERMINAL_ACCESSORY_KEYS,
  type TerminalAccessoryKey
} from '../terminal/terminal-accessory-keys'
import {
  ROW_DIVIDER_ID_PREFIX,
  isCustomAccessoryKeyId,
  parseTerminalAccessoryReorderIds,
  reconcileTerminalAccessoryLayoutCustomKeys,
  updateTerminalAccessoryRows,
  type TerminalAccessoryLayout
} from '../terminal/terminal-accessory-layout'
import type { CustomKey } from '../terminal/terminal-custom-keys'

export type UnifiedShortcutItem =
  | { kind: 'built-in'; id: string; shortcutKey: TerminalAccessoryKey }
  | { kind: 'custom'; id: string; customKey: CustomKey }
  | { kind: 'row-divider'; id: string; rowNumber: number }

export type LaidOutAccessory = TerminalAccessoryLayout & { rows: string[][]; rowCount: number }

const builtInIds = (): Set<string> => new Set(TERMINAL_ACCESSORY_KEYS.map((key) => key.id))

export function layoutRows(layout: TerminalAccessoryLayout): string[][] {
  if (layout.rows && layout.rows.length > 0) {
    return layout.rows.map((row) => [...row])
  }
  return [[...layout.orderedBuiltInIds]]
}

export function laidOut(layout: TerminalAccessoryLayout): LaidOutAccessory {
  const rows = layoutRows(layout)
  return { ...layout, rows, rowCount: layout.rowCount ?? rows.length }
}

export function reconcileRows(
  layout: TerminalAccessoryLayout,
  customKeyIds: string[]
): LaidOutAccessory {
  const helper = reconcileTerminalAccessoryLayoutCustomKeys(layout, customKeyIds)
  const source = helper.rows && helper.rows.length > 0 ? helper : layout
  const allowed = new Set(customKeyIds.filter(isCustomAccessoryKeyId))
  const rows = layoutRows(source).map((row) =>
    row.filter((id) => !isCustomAccessoryKeyId(id) || allowed.has(id))
  )
  const present = new Set(rows.flat())
  const last = rows[rows.length - 1] ?? []
  if (rows.length === 0) {
    rows.push(last)
  }
  for (const id of customKeyIds) {
    if (isCustomAccessoryKeyId(id) && !present.has(id)) {
      last.push(id)
      present.add(id)
    }
  }
  return {
    ...layout,
    ...helper,
    rows,
    rowCount: helper.rowCount ?? layout.rowCount ?? rows.length,
    orderedBuiltInIds: helper.orderedBuiltInIds ?? layout.orderedBuiltInIds,
    visibleBuiltInIds: helper.visibleBuiltInIds ?? layout.visibleBuiltInIds,
    directionPadEnabled: helper.directionPadEnabled ?? layout.directionPadEnabled
  }
}

function rowsWithBuiltInOrder(
  layout: TerminalAccessoryLayout,
  orderedBuiltInIds: string[]
): string[][] {
  const known = builtInIds()
  const queue = orderedBuiltInIds.filter((id) => known.has(id))
  const rows = layoutRows(layout).map((row) =>
    row.map((id) => (known.has(id) ? (queue.shift() ?? id) : id))
  )
  if (queue.length > 0) {
    rows[rows.length - 1]!.push(...queue)
  }
  return rows
}

function rowsWithCustomOrder(
  layout: TerminalAccessoryLayout,
  orderedCustomIds: string[]
): string[][] {
  const queue = [...orderedCustomIds]
  const rows = layoutRows(layout).map((row) =>
    row.flatMap((id) => {
      if (!isCustomAccessoryKeyId(id)) {
        return [id]
      }
      const next = queue.shift()
      return next ? [next] : []
    })
  )
  if (queue.length > 0) {
    rows[rows.length - 1]!.push(...queue)
  }
  return rows
}

function applyRowOrder(layout: TerminalAccessoryLayout, rows: string[][]): LaidOutAccessory {
  const updated = updateTerminalAccessoryRows(layout, rows)
  const known = builtInIds()
  const orderedBuiltInIds = rows.flat().filter((id) => known.has(id))
  const visible = new Set(updated.visibleBuiltInIds ?? layout.visibleBuiltInIds)
  return {
    ...layout,
    ...updated,
    rows,
    rowCount:
      layout.rowCount && rows.length === layout.rows?.length ? layout.rowCount : rows.length,
    orderedBuiltInIds,
    visibleBuiltInIds: orderedBuiltInIds.filter((id) => visible.has(id)),
    directionPadEnabled: updated.directionPadEnabled ?? layout.directionPadEnabled
  }
}

export function unifiedShortcutItems(
  layout: LaidOutAccessory,
  customKeys: CustomKey[]
): UnifiedShortcutItem[] {
  const builtInById = new Map(TERMINAL_ACCESSORY_KEYS.map((key) => [key.id, key]))
  const customById = new Map(customKeys.map((key) => [key.id, key]))
  return layout.rows.flatMap((rowIds, rowIndex) => [
    ...(rowIndex > 0
      ? [
          {
            kind: 'row-divider' as const,
            id: `${ROW_DIVIDER_ID_PREFIX}${rowIndex}__`,
            rowNumber: rowIndex + 1
          }
        ]
      : []),
    ...rowIds.flatMap((id): UnifiedShortcutItem[] => {
      const builtIn = builtInById.get(id)
      const custom = customById.get(id)
      return builtIn
        ? [{ kind: 'built-in', id, shortcutKey: builtIn }]
        : custom
          ? [{ kind: 'custom', id, customKey: custom }]
          : []
    })
  ])
}

export function planShortcutReorder(
  layout: TerminalAccessoryLayout,
  customKeys: CustomKey[],
  orderedIds: string[]
): { layout: LaidOutAccessory; customKeys: CustomKey[] } | null {
  const current = laidOut(layout)
  const known = builtInIds()
  const mentionsBuiltIn = orderedIds.some((id) => known.has(id))
  const mentionsCustom = orderedIds.some((id) => isCustomAccessoryKeyId(id))
  const mentionsDivider = orderedIds.some((id) => id.startsWith(ROW_DIVIDER_ID_PREFIX))

  if (mentionsBuiltIn && !mentionsCustom && !mentionsDivider) {
    return { layout: applyRowOrder(current, rowsWithBuiltInOrder(current, orderedIds)), customKeys }
  }

  if (!mentionsBuiltIn && mentionsCustom && !mentionsDivider) {
    const byId = new Map(customKeys.map((key) => [key.id, key]))
    const reordered = orderedIds.flatMap((id) => {
      const key = byId.get(id)
      return key ? [key] : []
    })
    if (reordered.length !== customKeys.length) {
      return null
    }
    return {
      customKeys: reordered,
      layout: applyRowOrder(
        current,
        rowsWithCustomOrder(
          current,
          reordered.map((key) => key.id)
        )
      )
    }
  }

  const nextLayout = applyRowOrder(
    current,
    parseTerminalAccessoryReorderIds(orderedIds, current.rowCount)
  )
  const byId = new Map(customKeys.map((key) => [key.id, key]))
  const nextCustom = nextLayout.rows.flat().flatMap((id) => byId.get(id) ?? [])
  const customChanged =
    nextCustom.length === customKeys.length &&
    nextCustom.some((key, index) => customKeys[index]?.id !== key.id)
  return { layout: nextLayout, customKeys: customChanged ? nextCustom : customKeys }
}
