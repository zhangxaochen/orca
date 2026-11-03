import { useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, Pressable } from 'react-native'
import {
  ChevronDown,
  ChevronUp,
  Ellipsis,
  Keyboard as KeyboardIcon,
  PenLine
} from 'lucide-react-native'
import { triggerMediumImpact } from '../platform/haptics'
import type {
  TerminalAccessoryKey,
  TerminalShortcutModifier
} from '../terminal/terminal-accessory-keys'
import type { TerminalAccessoryBarItem } from '../terminal/terminal-accessory-layout'
import type { CustomKey } from '../terminal/terminal-custom-keys'
import { compactTerminalKeyLabel, SPECIAL_KEY_LABELS } from '../terminal/terminal-key-definitions'
import { createTerminalLiveAccessoryInput } from '../terminal/terminal-live-accessory-input'
import { TERMINAL_ACCESSORY_REPEAT_DELAY_MS } from '../terminal/terminal-accessory-repeat'
import { isMobileTerminalTabRunningAgent } from './mobile-terminal-tab-agent'
import { TerminalArrowPad } from './TerminalArrowPad'
import { MobileTerminalMoreKeysSheet } from './MobileTerminalMoreKeysSheet'
import { TERMINAL_KEY_HIT_SLOP, terminalDockStyles as styles } from './terminal-dock-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors } from '../theme/mobile-theme'
import { useKeyboardPersistingTaps } from '../platform/keyboard-persisting-taps'
import type { StickyModifiers } from '../terminal/terminal-sticky-modifiers'
import { terminalDockKeyInput } from './use-terminal-dock-keys'
import type { MobileSessionController } from './use-mobile-session-controller'

const ESC = '\x1b'
const CTRL_C = '\x03'
const SHELL_CHARACTERS = ['/', '|', '~', '-', ':']
const AGENT_CHARACTERS = ['/', '@', '!']
const ARROW_KEY_IDS = new Set(['arrowUp', 'arrowDown', 'arrowLeft', 'arrowRight'])

// The terminal's key rows above the input; the Duo's side rail shows the same keys. Every key goes straight to the terminal.
export function MobileSessionAccessoryKeys({
  controller
}: {
  controller: MobileSessionController
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const {
    activeSessionTab,
    canSend,
    canCompose,
    liveInputEnabled,
    visibleAccessoryRows,
    directionPadEnabled = true,
    setDeleteKeyTarget,
    handleAccessoryKey,
    dockKeys: keys,
    toggleLiveInput,
    stopAccessoryRepeat,
    cancelAccessoryRepeat,
    prepareAccessoryPress
  } = controller
  const keepsKeyboard = useKeyboardPersistingTaps('always')
  const [padHeld, setPadHeld] = useState(false)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [rowsCollapsed, setRowsCollapsed] = useState(false)
  const repeatablePresses = useRef(new Map<string, ReturnType<typeof prepareAccessoryPress>>())
  const padPressRef = useRef<{
    modifiers: StickyModifiers
    tap: (() => Promise<boolean>) | null
  } | null>(null)
  // An unmounting row never sees a held arrow lift.
  useEffect(() => cancelAccessoryRepeat, [cancelAccessoryRepeat])

  const runsAgent =
    activeSessionTab?.type === 'terminal' && isMobileTerminalTabRunningAgent(activeSessionTab)
  const keyStyle = styles.key
  const sendBytes = (bytes: string) => void handleAccessoryKey({ bytes })

  const keyButton = (
    id: string,
    label: string,
    accessibilityLabel: string,
    onPress: () => void
  ) => (
    <Pressable
      key={id}
      style={({ pressed }) => [keyStyle, pressed && styles.keyPressed, !canSend && styles.disabled]}
      disabled={!canSend}
      hitSlop={TERMINAL_KEY_HIT_SLOP}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.keyText}>{label}</Text>
    </Pressable>
  )
  const sendKeyLabel = (label: string) =>
    t('session.accessoryKeys.sendKey', 'Send {{label}}', { label })
  const specialKey = (id: string, label: string, name: string) =>
    keyButton(id, label, sendKeyLabel(name), () => keys.sendKey(id))
  const modifierKey = (modifier: TerminalShortcutModifier, label: string, name: string) => {
    const latch = keys.modifiers[modifier]
    return (
      <Pressable
        key={modifier}
        style={({ pressed }) => [
          keyStyle,
          latch === 'once' && styles.keyOnce,
          latch === 'locked' && styles.keyLocked,
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
            latch === 'once' && styles.keyOnceText,
            latch === 'locked' && styles.keyLockedText
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
  const arrowPad = (
    <TerminalArrowPad
      key="arrows"
      disabled={!canSend}
      // Prepared on touch-down, so a lift after a terminal switch can't land on the new terminal.
      onPressStart={(side) => {
        const modifiers = keys.takeModifiers()
        const input = terminalDockKeyInput(side, modifiers)
        padPressRef.current = { modifiers, tap: input ? prepareAccessoryPress(input).tap : null }
      }}
      onTap={() => {
        void padPressRef.current?.tap?.()
        padPressRef.current = null
      }}
      onRepeatStart={(arrow) => {
        const input = terminalDockKeyInput(arrow, padPressRef.current?.modifiers ?? keys.modifiers)
        if (input) {
          prepareAccessoryPress(input).hold(TERMINAL_ACCESSORY_REPEAT_DELAY_MS)
        }
      }}
      onRepeatStop={() => {
        padPressRef.current = null
        stopAccessoryRepeat()
      }}
      onAccessibilityArrow={keys.sendKey}
      onHoldChange={setPadHeld}
    />
  )
  const ctrlKey = modifierKey('ctrl', '^', t('session.accessoryKeys.control', 'Control'))
  const altKey = modifierKey('alt', '⌥', t('session.accessoryKeys.alt', 'Alt'))
  const shiftKey = modifierKey('shift', '⇧', t('session.accessoryKeys.shift', 'Shift'))

  const renderBuiltInItem = (item: TerminalAccessoryKey): React.JSX.Element => {
    const a11y = sendKeyLabel(item.accessibilityLabel ?? item.label)
    const displayLabel = compactTerminalKeyLabel(item.label)
    if (item.repeatable) {
      const input = createTerminalLiveAccessoryInput(item)
      return (
        <Pressable
          key={item.id}
          style={({ pressed }) => [
            keyStyle,
            pressed && styles.keyPressed,
            !canSend && styles.disabled
          ]}
          disabled={!canSend}
          hitSlop={TERMINAL_KEY_HIT_SLOP}
          onPressIn={(event) => {
            const press = prepareAccessoryPress(input)
            repeatablePresses.current.set(item.id, press)
            if (event.type === 'keydown') {
              press.hold(TERMINAL_ACCESSORY_REPEAT_DELAY_MS)
            }
          }}
          onPressOut={stopAccessoryRepeat}
          onPress={(event) => {
            const a11yClick =
              event.type === 'click' &&
              'detail' in event.nativeEvent &&
              event.nativeEvent.detail === 0
            const press =
              (!a11yClick && repeatablePresses.current.get(item.id)) || prepareAccessoryPress(input)
            repeatablePresses.current.delete(item.id)
            void press.tap()
          }}
          onLongPress={() => repeatablePresses.current.get(item.id)?.hold()}
          delayLongPress={TERMINAL_ACCESSORY_REPEAT_DELAY_MS}
          accessibilityRole="button"
          accessibilityLabel={a11y}
        >
          <Text style={styles.keyText}>{displayLabel}</Text>
        </Pressable>
      )
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
          style={({ pressed }) => [
            keyStyle,
            styles.customKey,
            pressed && styles.keyPressed,
            !canSend && styles.disabled
          ]}
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
        >
          <Text style={styles.keyText}>{compactTerminalKeyLabel(custom.label)}</Text>
        </Pressable>
      )
    }
    return directionPadEnabled && ARROW_KEY_IDS.has(item.key.id)
      ? null
      : renderBuiltInItem(item.key)
  }

  const hasConfiguredRows = Boolean(visibleAccessoryRows?.some((row) => row.length > 0))
  const rawRows = hasConfiguredRows && visibleAccessoryRows ? visibleAccessoryRows : [[]]
  const hasMultipleRows = rawRows.length > 1
  const displayedRows = hasMultipleRows && rowsCollapsed ? [rawRows.flat()] : rawRows
  const chars = characterKeys(runsAgent ? AGENT_CHARACTERS : SHELL_CHARACTERS)

  const fallbackRowKeys = runsAgent
    ? [
        specialKey('escape', 'Esc', t('session.accessoryKeys.escape', 'Escape')),
        keyButton(
          'shiftTab',
          '⇧Tab',
          sendKeyLabel(t('session.accessoryKeys.shiftTab', 'Shift Tab')),
          () => sendBytes(`${ESC}[Z`)
        ),
        ...(directionPadEnabled ? [arrowPad] : []),
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
        ...(directionPadEnabled ? [arrowPad] : []),
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
        ? [
            ctrlKey,
            ...(runsAgent ? [] : [altKey, shiftKey]),
            ...(directionPadEnabled ? [arrowPad] : [])
          ]
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
            {isFirstRow ? (
              <Pressable
                style={({ pressed }) => [
                  styles.modeKey,
                  pressed && styles.keyPressed,
                  !canCompose && styles.disabled
                ]}
                // Offline, Keys mode is dead but the composer still composes; keep the escape hatch tappable (#6713).
                disabled={!canCompose}
                hitSlop={TERMINAL_KEY_HIT_SLOP}
                onPress={toggleLiveInput}
                accessibilityRole="button"
                accessibilityLabel={
                  liveInputEnabled
                    ? t(
                        'session.accessoryKeys.keysModeLabel',
                        'Keys mode: typing goes straight to the terminal. Switch to Message mode'
                      )
                    : t(
                        'session.accessoryKeys.messageModeLabel',
                        'Message mode: write, then send. Switch to Keys mode'
                      )
                }
              >
                {liveInputEnabled ? (
                  <KeyboardIcon size={14} color={colors.textPrimary} strokeWidth={2} />
                ) : (
                  <PenLine size={14} color={colors.textPrimary} strokeWidth={2} />
                )}
              </Pressable>
            ) : null}
            {/* Why: default tap handling makes the first key tap dismiss the keyboard and get swallowed (#5106). */}
            <ScrollView
              style={styles.keyScroll}
              horizontal
              scrollEnabled={!padHeld}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.keyScrollContent}
              keyboardShouldPersistTaps="always"
              onScrollBeginDrag={cancelAccessoryRepeat}
            >
              {buildRowContent(rowItems, rowIndex, isLastRow)}
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
