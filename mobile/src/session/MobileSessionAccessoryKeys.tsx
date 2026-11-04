import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView, Pressable } from 'react-native'
import {
  ChevronDown,
  ChevronUp,
  Ellipsis,
  Keyboard as KeyboardIcon,
  Monitor,
  Plus,
  Smartphone
} from 'lucide-react-native'
import { triggerMediumImpact } from '../platform/haptics'
import type {
  TerminalAccessoryKey,
  TerminalShortcutModifier
} from '../terminal/terminal-accessory-keys'
import {
  getVisibleTerminalAccessoryKeys,
  type TerminalAccessoryBarItem
} from '../terminal/terminal-accessory-layout'
import type { CustomKey } from '../terminal/terminal-custom-keys'
import { compactTerminalKeyLabel, SPECIAL_KEY_LABELS } from '../terminal/terminal-key-definitions'
import {
  createTerminalLiveAccessoryInput,
  type TerminalLiveAccessoryInput
} from '../terminal/terminal-live-accessory-input'
import { createTerminalKeyChordInput } from '../terminal/terminal-key-chord-input'
import { TERMINAL_ACCESSORY_REPEAT_DELAY_MS } from '../terminal/terminal-accessory-repeat'
import { useDirectionPadAvailable } from '../layout/use-shell-side-rail'
import { isMobileTerminalTabRunningAgent } from './mobile-terminal-tab-agent'
import { isTerminalPhoneDisplayMode } from './mobile-session-route-helpers'
import { MobileTerminalMoreKeysSheet } from './MobileTerminalMoreKeysSheet'
import { TERMINAL_KEY_HIT_SLOP, terminalDockStyles as styles } from './terminal-dock-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors } from '../theme/mobile-theme'
import { styles as sessionStyles } from './mobile-session-styles'
import { useKeyboardPersistingTaps } from '../platform/keyboard-persisting-taps'
import type { MobileSessionController } from './use-mobile-session-controller'

const ESC = '\x1b'
const CTRL_C = '\x03'
const SHELL_CHARACTERS = ['/', '|', '~', '-', ':']
const AGENT_CHARACTERS = ['/', '@', '!']
const ARROW_KEY_IDS = new Set(['arrowUp', 'arrowDown', 'arrowLeft', 'arrowRight'])

// The terminal's key rows above the live input; the Duo's side rail shows the same keys. Every key goes straight to the terminal.
export function MobileSessionAccessoryKeys({
  controller
}: {
  controller: MobileSessionController
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const {
    activeHandle,
    activeSessionTab,
    customKeys: _customKeys,
    setShowCustomKeyModal,
    setDeleteKeyTarget,
    visibleBuiltInIds,
    visibleAccessoryRows,
    directionPadEnabled = true,
    terminalModes,
    canPaste,
    canSend,
    toggleDisplayMode,
    handleAccessoryKey,
    dockKeys: keys,
    dismissSoftwareKeyboard,
    stopAccessoryRepeat,
    cancelAccessoryRepeat,
    prepareAccessoryPress,
    handlePaste,
    keyboardLift
  } = controller
  const keepsKeyboard = useKeyboardPersistingTaps('always')
  const [sheetVisible, setSheetVisible] = useState(false)
  const [rowsCollapsed, setRowsCollapsed] = useState(false)
  const repeatablePresses = useRef(new Map<string, ReturnType<typeof prepareAccessoryPress>>())
  // An unmounting Pressable never fires onPressOut, so a held key would outlive its row.
  useEffect(() => cancelAccessoryRepeat, [cancelAccessoryRepeat])

  const runsAgent =
    activeSessionTab?.type === 'terminal' && isMobileTerminalTabRunningAgent(activeSessionTab)
  const phoneDisplay = isTerminalPhoneDisplayMode(activeHandle, terminalModes)
  // A D-pad device's layout leaves the arrows to the rail. This row shows without the rail, so the arrows come back here.
  const padAvailable = useDirectionPadAvailable()
  const detachedArrows = useMemo(
    () =>
      directionPadEnabled || padAvailable
        ? getVisibleTerminalAccessoryKeys(visibleBuiltInIds, true).filter((key) =>
            ARROW_KEY_IDS.has(key.id)
          )
        : [],
    [directionPadEnabled, padAvailable, visibleBuiltInIds]
  )
  const keyStyle = ({ pressed }: { pressed: boolean }) => [
    styles.key,
    pressed && styles.keyPressed,
    !canSend && styles.disabled
  ]
  const sendBytes = (bytes: string) => void handleAccessoryKey({ bytes })
  const sendKeyLabel = (label: string) =>
    t('session.accessoryKeys.sendKey', 'Send {{label}}', { label })

  const keyButton = (id: string, label: string, accessibilityLabel: string, onPress: () => void) => (
    <Pressable
      key={id}
      style={keyStyle}
      disabled={!canSend}
      hitSlop={TERMINAL_KEY_HIT_SLOP}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.keyText}>{label}</Text>
    </Pressable>
  )
  const repeatableKey = (
    id: string,
    label: string,
    accessibilityLabel: string,
    createInput: () => TerminalLiveAccessoryInput | null
  ) => (
    <Pressable
      key={id}
      style={keyStyle}
      disabled={!canSend}
      hitSlop={TERMINAL_KEY_HIT_SLOP}
      onPressIn={(event) => {
        const input = createInput()
        if (!input) {
          return
        }
        const press = prepareAccessoryPress(input)
        repeatablePresses.current.set(id, press)
        if (event.type === 'keydown') {
          press.hold(TERMINAL_ACCESSORY_REPEAT_DELAY_MS)
        }
      }}
      onPressOut={stopAccessoryRepeat}
      onPress={(event) => {
        // Accessibility clicks have no touch-down to prepare a sender.
        const accessibilityClick =
          event.type === 'click' && 'detail' in event.nativeEvent && event.nativeEvent.detail === 0
        const stored = !accessibilityClick ? repeatablePresses.current.get(id) : undefined
        repeatablePresses.current.delete(id)
        const fallbackInput = stored ? null : createInput()
        const press = stored ?? (fallbackInput ? prepareAccessoryPress(fallbackInput) : null)
        void press?.tap()
      }}
      onLongPress={() => repeatablePresses.current.get(id)?.hold()}
      delayLongPress={TERMINAL_ACCESSORY_REPEAT_DELAY_MS}
      // A web <button> clicks on Enter keydown as well, which would send a held key twice.
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.keyText}>{label}</Text>
    </Pressable>
  )
  const specialKey = (id: string, label: string, name: string) =>
    keyButton(id, label, sendKeyLabel(name), () => keys.sendKey(id))
  const modifierKey = (modifier: TerminalShortcutModifier, label: string, name: string) => {
    const latch = keys.modifiers[modifier]
    return (
      <Pressable
        key={modifier}
        style={({ pressed }) => [
          styles.key,
          latch === 'once' && { borderColor: colors.accentBlue },
          latch === 'locked' && { backgroundColor: colors.accentBlue },
          pressed && styles.keyPressed,
          !canSend && styles.disabled
        ]}
        disabled={!canSend}
        hitSlop={TERMINAL_KEY_HIT_SLOP}
        onPress={() => keys.tapModifier(modifier)}
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityHint={t(
          'session.accessoryKeys.modifierHint',
          'Applies to the next key. Double tap to keep it on.'
        )}
        accessibilityState={{ selected: latch !== 'off' }}
      >
        <Text
          style={[
            styles.keyText,
            latch === 'once' && { color: colors.accentBlue },
            latch === 'locked' && { color: colors.onAccent }
          ]}
        >
          {label}
        </Text>
      </Pressable>
    )
  }
  const characterKeys = (characters: readonly string[]) =>
    characters.map((character) =>
      keyButton(
        `char-${character}`,
        character,
        t('session.accessoryKeys.typeCharacter', 'Type {{character}}', { character }),
        () => keys.sendKey(character)
      )
    )
  const renderModifierArrow = (item: TerminalAccessoryKey): React.JSX.Element =>
    repeatableKey(
      item.id,
      compactTerminalKeyLabel(item.label),
      sendKeyLabel(item.accessibilityLabel ?? item.label),
      () => {
        const modifiers = keys.takeModifiers()
        return createTerminalKeyChordInput({
          key: item.id,
          ctrl: modifiers.ctrl !== 'off',
          alt: modifiers.alt !== 'off',
          shift: modifiers.shift !== 'off'
        })
      }
    )
  const renderBuiltInItem = (item: TerminalAccessoryKey): React.JSX.Element => {
    const a11y = sendKeyLabel(item.accessibilityLabel ?? item.label)
    const displayLabel = compactTerminalKeyLabel(item.label)
    if (item.repeatable) {
      const input = createTerminalLiveAccessoryInput(item)
      return repeatableKey(item.id, displayLabel, a11y, () => input)
    }
    return keyButton(item.id, displayLabel, a11y, () =>
      SPECIAL_KEY_LABELS[item.id]
        ? keys.sendKey(item.id)
        : void handleAccessoryKey(createTerminalLiveAccessoryInput(item))
    )
  }
  const renderConfiguredItem = (
    item: TerminalAccessoryBarItem<CustomKey>
  ): React.JSX.Element | null => {
    if (item.kind === 'custom') {
      const custom = item.key
      return (
        <Pressable
          key={custom.id}
          style={({ pressed }) => [...keyStyle({ pressed }), styles.customKey]}
          disabled={!canSend}
          hitSlop={TERMINAL_KEY_HIT_SLOP}
          onPress={() => sendBytes(custom.bytes)}
          onLongPress={() => {
            triggerMediumImpact()
            setDeleteKeyTarget(custom)
          }}
          delayLongPress={400}
          accessibilityRole="button"
          accessibilityLabel={sendKeyLabel(custom.label)}
          accessibilityHint={t(
            'session.terminalMoreKeys.deleteKeyHint',
            'Long press to delete this key'
          )}
        >
          <Text style={styles.keyText}>{compactTerminalKeyLabel(custom.label)}</Text>
        </Pressable>
      )
    }
    return directionPadEnabled && ARROW_KEY_IDS.has(item.key.id) ? null : renderBuiltInItem(item.key)
  }

  const hasConfiguredRows = Boolean(visibleAccessoryRows?.some((row) => row.length > 0))
  const rawRows = hasConfiguredRows && visibleAccessoryRows ? visibleAccessoryRows : [[]]
  const hasMultipleRows = rawRows.length > 1
  const displayedRows = hasMultipleRows && rowsCollapsed ? [rawRows.flat()] : rawRows
  const layoutHasArrows =
    hasConfiguredRows &&
    rawRows.some((row) =>
      row.some((item) => item.kind === 'built-in' && ARROW_KEY_IDS.has(item.key.id))
    )
  const arrowCluster = directionPadEnabled
    ? detachedArrows.map(renderModifierArrow)
    : padAvailable && !layoutHasArrows
      ? detachedArrows.map(renderBuiltInItem)
      : []
  const chars = characterKeys(runsAgent ? AGENT_CHARACTERS : SHELL_CHARACTERS)
  const ctrlKey = modifierKey('ctrl', '^', t('session.accessoryKeys.control', 'Control'))
  const altKey = modifierKey('alt', '⌥', t('session.accessoryKeys.alt', 'Alt'))
  const shiftKey = modifierKey('shift', '⇧', t('session.accessoryKeys.shift', 'Shift'))

  const fallbackRowKeys = runsAgent
    ? [
        specialKey('escape', 'Esc', t('session.accessoryKeys.escape', 'Escape')),
        keyButton(
          'shiftTab',
          '⇧Tab',
          sendKeyLabel(t('session.accessoryKeys.shiftTab', 'Shift Tab')),
          () => sendBytes(`${ESC}[Z`)
        ),
        ...arrowCluster,
        specialKey('enter', '⏎', t('session.accessoryKeys.enter', 'Enter')),
        keyButton('ctrlC', '^C', t('session.accessoryKeys.interrupt', 'Interrupt terminal'), () =>
          sendBytes(CTRL_C)
        ),
        ctrlKey,
        ...chars
      ]
    : [
        specialKey('escape', 'Esc', t('session.accessoryKeys.escape', 'Escape')),
        ctrlKey,
        specialKey('tab', 'Tab', t('session.accessoryKeys.tab', 'Tab')),
        ...arrowCluster,
        altKey,
        shiftKey,
        ...chars
      ]

  const buildRowContent = (
    rowItems: TerminalAccessoryBarItem<CustomKey>[],
    rowIndex: number,
    isLastRow: boolean
  ) => {
    if (!hasConfiguredRows) {
      return fallbackRowKeys
    }
    const configuredNodes = rowItems
      .map(renderConfiguredItem)
      .filter((node): node is React.JSX.Element => node !== null)
    const leading =
      rowIndex === 0
        ? [ctrlKey, ...(runsAgent ? [] : [altKey, shiftKey]), ...arrowCluster]
        : []
    return [...leading, ...configuredNodes, ...(isLastRow ? chars : [])]
  }

  const moreKeysButton = (
    <Pressable
      key="more-keys"
      style={({ pressed }) => [styles.ghostKey, pressed && styles.keyPressed]}
      hitSlop={TERMINAL_KEY_HIT_SLOP}
      onPress={() => setSheetVisible(true)}
      accessibilityRole="button"
      accessibilityLabel={t('session.accessoryKeys.moreKeys', 'More keys and actions')}
    >
      <Ellipsis size={17} color={colors.textSecondary} strokeWidth={2.2} />
    </Pressable>
  )

  return (
    <View ref={keepsKeyboard} style={hasMultipleRows ? styles.keyRowsStack : undefined}>
      {displayedRows.map((rowItems, rowIndex) => {
        const isFirstRow = rowIndex === 0
        const isLastRow = rowIndex === displayedRows.length - 1
        return (
          <View
            key={`dock-key-row-${displayedRows.length}-${rowIndex}`}
            style={isFirstRow ? styles.keyRow : styles.keyRowSecondary}
          >
            {/* Why: fixed keyboard escape hatch; outside the ScrollView so it can't scroll away (#5106). */}
            {isFirstRow && keyboardLift > 0 ? (
              <Pressable
                style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                onPress={dismissSoftwareKeyboard}
                hitSlop={TERMINAL_KEY_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={t('session.accessoryKeys.dismissKeyboard', 'Dismiss keyboard')}
                accessibilityHint={t(
                  'session.accessoryKeys.dismissKeyboardHint',
                  'Hides the software keyboard and keeps the current terminal session open.'
                )}
              >
                <View style={sessionStyles.keyboardDismissGlyph}>
                  <KeyboardIcon size={15} color={colors.textPrimary} strokeWidth={2} />
                  <ChevronDown
                    size={10}
                    color={colors.textPrimary}
                    strokeWidth={2.5}
                    style={sessionStyles.keyboardDismissChevron}
                  />
                </View>
              </Pressable>
            ) : null}
            {/* Why: default tap handling makes the first key tap dismiss the keyboard and get swallowed (#5106). */}
            <ScrollView
              style={styles.keyScroll}
              horizontal
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.keyScrollContent}
              keyboardShouldPersistTaps="always"
              onScrollBeginDrag={cancelAccessoryRepeat}
            >
              {isFirstRow ? (
                <Pressable
                  style={keyStyle}
                  disabled={!canSend}
                  hitSlop={TERMINAL_KEY_HIT_SLOP}
                  onPress={() => {
                    if (activeHandle) {
                      void toggleDisplayMode(activeHandle)
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    phoneDisplay
                      ? t('session.accessoryKeys.switchToDesktopMode', 'Switch to desktop mode')
                      : t('session.accessoryKeys.switchToPhoneMode', 'Switch to phone mode')
                  }
                >
                  {phoneDisplay ? (
                    <Monitor size={15} color={colors.textPrimary} strokeWidth={2} />
                  ) : (
                    <Smartphone size={15} color={colors.textPrimary} strokeWidth={2} />
                  )}
                </Pressable>
              ) : null}
              {isFirstRow && canPaste ? (
                <Pressable
                  style={keyStyle}
                  disabled={!canSend}
                  hitSlop={TERMINAL_KEY_HIT_SLOP}
                  onPress={() => void handlePaste()}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    'session.accessoryKeys.pasteFromClipboard',
                    'Paste from clipboard'
                  )}
                >
                  <Text style={styles.keyText}>{t('session.accessoryKeys.paste', 'Paste')}</Text>
                </Pressable>
              ) : null}
              {buildRowContent(rowItems, rowIndex, isLastRow)}
              {isLastRow ? (
                <Pressable
                  key="add-custom-key"
                  style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
                  hitSlop={TERMINAL_KEY_HIT_SLOP}
                  onPress={() => setShowCustomKeyModal(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    'session.accessoryKeys.addCustomShortcut',
                    'Add custom shortcut'
                  )}
                >
                  <Plus size={15} color={colors.textPrimary} strokeWidth={2.2} />
                </Pressable>
              ) : null}
              {isLastRow ? moreKeysButton : null}
            </ScrollView>
            {isFirstRow && hasMultipleRows ? (
              <Pressable
                style={({ pressed }) => [styles.iconKey, pressed && styles.keyPressed]}
                onPress={() => setRowsCollapsed((prev) => !prev)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  rowsCollapsed ? 'Expand shortcut rows' : 'Collapse shortcut rows to single row'
                }
              >
                {rowsCollapsed ? (
                  <ChevronUp size={15} color={colors.textSecondary} strokeWidth={2.2} />
                ) : (
                  <ChevronDown size={15} color={colors.textSecondary} strokeWidth={2.2} />
                )}
              </Pressable>
            ) : null}
          </View>
        )
      })}
      <MobileTerminalMoreKeysSheet
        controller={controller}
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  )
}
