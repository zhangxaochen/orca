import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { useFocusEffect } from 'expo-router'
import type { Translate } from '../i18n/mobile-i18n'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { useDirectionPadAvailable } from '../layout/use-shell-side-rail'
import { useSerializedStoredState } from '../storage/use-serialized-stored-state'
import {
  MAX_TERMINAL_ACCESSORY_ROWS,
  MIN_TERMINAL_ACCESSORY_ROWS,
  getDefaultTerminalAccessoryLayout,
  loadTerminalAccessoryLayout,
  saveTerminalAccessoryLayout,
  setTerminalAccessoryBuiltInVisible,
  setTerminalAccessoryRowCount,
  type TerminalAccessoryLayout
} from '../terminal/terminal-accessory-layout'
import { loadCustomKeys, saveCustomKeys, type CustomKey } from '../terminal/terminal-custom-keys'
import {
  laidOut,
  planShortcutReorder,
  reconcileRows,
  unifiedShortcutItems,
  type UnifiedShortcutItem
} from './terminal-shortcut-settings-layout'

function useShortcutStore<T>(
  initial: T | (() => T),
  load: () => Promise<T>,
  save: (value: T) => Promise<void>
) {
  const inflightRef = useRef(0)
  const [ready, setReady] = useState(false)
  const read = useCallback(async () => {
    inflightRef.current += 1
    setReady(false)
    try {
      return await load()
    } finally {
      inflightRef.current -= 1
      setReady(inflightRef.current === 0)
    }
  }, [load])
  const stored = useSerializedStoredState(initial, read, save)
  const valueRef = useRef(stored.value)
  valueRef.current = stored.value
  const refresh = useCallback(() => {
    // An older read must not land after this one starts.
    stored.adoptStored(valueRef.current)
    stored.refresh()
  }, [stored.adoptStored, stored.refresh])
  return { ...stored, refresh, ready, valueRef }
}

export function useTerminalShortcutEditor(): {
  t: Translate
  hasPad: boolean
  canEdit: boolean
  directionPadEnabled: boolean
  rowCount: number
  canDecreaseRows: boolean
  canIncreaseRows: boolean
  unifiedItems: UnifiedShortcutItem[]
  visibleBuiltInIds: string[]
  showCustomKeyModal: boolean
  editingCustomKey: CustomKey | null
  showLabel: (label: string) => string
  toggleDirectionPad: (enabled: boolean) => void
  setRowCount: (delta: -1 | 1) => void
  resetLayout: () => void
  reorder: (orderedIds: string[]) => void
  toggleBuiltIn: (id: string, visible: boolean) => void
  setCustomVisibility: (id: string, visible: boolean) => void
  removeCustomKey: (id: string) => void
  openEditor: (key: CustomKey | null) => void
  closeEditor: () => void
  applyStoredCustomKeys: (keys: CustomKey[]) => void
} {
  const t = useMobileTranslation()
  const hasPad = useDirectionPadAvailable()
  const defaultLayout = useCallback(() => getDefaultTerminalAccessoryLayout(hasPad), [hasPad])
  const loadLayout = useCallback(() => loadTerminalAccessoryLayout(hasPad), [hasPad])
  const layoutStore = useShortcutStore(defaultLayout, loadLayout, saveTerminalAccessoryLayout)
  const customStore = useShortcutStore<CustomKey[]>([], loadCustomKeys, saveCustomKeys)
  const canEdit = layoutStore.ready && customStore.ready
  const [showCustomKeyModal, setShowCustomKeyModal] = useState(false)
  const [editingCustomKey, setEditingCustomKey] = useState<CustomKey | null>(null)
  const customKeyIds = useMemo(() => customStore.value.map((key) => key.id), [customStore.value])
  const effectiveLayout = useMemo(
    () => reconcileRows(layoutStore.value, customKeyIds),
    [customKeyIds, layoutStore.value]
  )
  const unifiedItems = useMemo(
    () => unifiedShortcutItems(effectiveLayout, customStore.value),
    [customStore.value, effectiveLayout]
  )

  const refreshAll = useCallback(() => {
    layoutStore.refresh()
    customStore.refresh()
  }, [customStore.refresh, layoutStore.refresh])

  useFocusEffect(refreshAll)

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        refreshAll()
      }
    })
    return () => sub.remove()
  }, [refreshAll])

  const commitLayout = useCallback(
    (next: TerminalAccessoryLayout) => {
      const current = layoutStore.valueRef.current
      const saved = laidOut({
        ...current,
        ...next,
        rows: next.rows ?? current.rows,
        rowCount: next.rowCount ?? current.rowCount,
        directionPadEnabled: next.directionPadEnabled ?? current.directionPadEnabled
      })
      layoutStore.valueRef.current = saved
      layoutStore.setValue(saved)
      layoutStore.persist(saved)
    },
    [layoutStore.persist, layoutStore.setValue, layoutStore.valueRef]
  )

  const writeCustomKeys = useCallback(
    (keys: CustomKey[], persistKeys: boolean) => {
      if (!canEdit && persistKeys) {
        return
      }
      customStore.valueRef.current = keys
      if (persistKeys) {
        customStore.setValue(keys)
        customStore.persist(keys)
      } else {
        customStore.adoptStored(keys)
      }
      commitLayout(
        reconcileRows(
          layoutStore.valueRef.current,
          keys.map((key) => key.id)
        )
      )
    },
    [canEdit, commitLayout, customStore, layoutStore.valueRef]
  )

  const showLabel = useCallback(
    (label: string) =>
      t('components.terminalShortcutSettings.showShortcut', 'Show {{label}} shortcut', { label }),
    [t]
  )

  const toggleBuiltIn = useCallback(
    (id: string, visible: boolean) => {
      if (!canEdit) {
        return
      }
      const current = reconcileRows(
        layoutStore.valueRef.current,
        customStore.valueRef.current.map((key) => key.id)
      )
      commitLayout(setTerminalAccessoryBuiltInVisible(current, id, visible))
    },
    [canEdit, commitLayout, customStore.valueRef, layoutStore.valueRef]
  )

  const toggleDirectionPad = useCallback(
    (enabled: boolean) => {
      if (!canEdit) {
        return
      }
      commitLayout({ ...layoutStore.valueRef.current, directionPadEnabled: enabled })
    },
    [canEdit, commitLayout, layoutStore.valueRef]
  )

  const setRowCount = useCallback(
    (delta: -1 | 1) => {
      if (!canEdit) {
        return
      }
      const current = laidOut(layoutStore.valueRef.current)
      commitLayout(setTerminalAccessoryRowCount(current, current.rowCount + delta))
    },
    [canEdit, commitLayout, layoutStore.valueRef]
  )

  const resetLayout = useCallback(() => {
    if (!canEdit) {
      return
    }
    commitLayout(
      reconcileRows(
        defaultLayout(),
        customStore.valueRef.current.map((key) => key.id)
      )
    )
  }, [canEdit, commitLayout, customStore.valueRef, defaultLayout])

  const removeCustomKey = useCallback(
    (id: string) => {
      if (!canEdit) {
        return
      }
      writeCustomKeys(
        customStore.valueRef.current.filter((key) => key.id !== id),
        true
      )
    },
    [canEdit, customStore.valueRef, writeCustomKeys]
  )

  const reorder = useCallback(
    (orderedIds: string[]) => {
      if (!canEdit) {
        return
      }
      const planned = planShortcutReorder(
        layoutStore.valueRef.current,
        customStore.valueRef.current,
        orderedIds
      )
      if (!planned) {
        return
      }
      if (planned.customKeys !== customStore.valueRef.current) {
        customStore.valueRef.current = planned.customKeys
        customStore.setValue(planned.customKeys)
        customStore.persist(planned.customKeys)
      }
      commitLayout(planned.layout)
    },
    [canEdit, commitLayout, customStore, layoutStore.valueRef]
  )

  return {
    t,
    hasPad,
    canEdit,
    directionPadEnabled: layoutStore.value.directionPadEnabled !== false,
    rowCount: effectiveLayout.rowCount,
    canDecreaseRows: canEdit && effectiveLayout.rowCount > MIN_TERMINAL_ACCESSORY_ROWS,
    canIncreaseRows: canEdit && effectiveLayout.rowCount < MAX_TERMINAL_ACCESSORY_ROWS,
    unifiedItems,
    visibleBuiltInIds: effectiveLayout.visibleBuiltInIds,
    showCustomKeyModal,
    editingCustomKey,
    showLabel,
    toggleDirectionPad,
    setRowCount,
    resetLayout,
    reorder,
    toggleBuiltIn,
    setCustomVisibility: (id: string, visible: boolean) =>
      writeCustomKeys(
        customStore.valueRef.current.map((key) => (key.id === id ? { ...key, visible } : key)),
        true
      ),
    removeCustomKey,
    openEditor: (key: CustomKey | null) => {
      setEditingCustomKey(key)
      setShowCustomKeyModal(true)
    },
    closeEditor: () => {
      setShowCustomKeyModal(false)
      setEditingCustomKey(null)
    },
    applyStoredCustomKeys: (keys: CustomKey[]) => writeCustomKeys(keys, false)
  }
}
