import { useState } from 'react'
import { View, Text, ScrollView, Pressable } from 'react-native'
import {
  ChevronDown,
  ChevronUp,
  ChevronsRight,
  Keyboard as KeyboardIcon,
  Monitor,
  Plus,
  Smartphone
} from 'lucide-react-native'

import { triggerMediumImpact } from '../platform/haptics'
import { createTerminalLiveAccessoryInput } from '../terminal/terminal-live-accessory-input'
import { keepHeldPressThroughLongPress } from './held-press-long-press'
import { isTerminalPhoneDisplayMode } from './mobile-session-route-helpers'
import { colors } from '../theme/mobile-theme'
import { styles } from './mobile-session-styles'
import { useKeyboardPersistingTaps } from '../platform/keyboard-persisting-taps'
import type { MobileSessionController } from './use-mobile-session-controller'

/** Shortcut row above the command field. The dismiss key stays outside the scroller. */
export function MobileSessionCommandAccessoryBar({
  controller
}: {
  controller: MobileSessionController
}) {
  const {
    activeHandle,
    setShowCustomKeyModal,
    setDeleteKeyTarget,
    visibleAccessoryRows,
    terminalModes,
    canPaste,
    canSend,
    canCompose,
    liveInputEnabled,
    toggleDisplayMode,
    handleAccessoryKey,
    dismissSoftwareKeyboard,
    toggleLiveInput,
    stopAccessoryRepeat,
    startAccessoryRepeat,
    consumeAccessoryRepeatHandled,
    handlePaste,
    keyboardLift
  } = controller
  const [isAccessoryRowsCollapsed, setIsAccessoryRowsCollapsed] = useState(false)
  const safeAccessoryRows = visibleAccessoryRows ?? []
  const hasMultipleAccessoryRows = safeAccessoryRows.length > 1
  const displayedAccessoryRows =
    hasMultipleAccessoryRows && isAccessoryRowsCollapsed
      ? [safeAccessoryRows.flat()]
      : safeAccessoryRows
  const accessoryBarKeepsKeyboard = useKeyboardPersistingTaps('always')
  const isPhoneMode = isTerminalPhoneDisplayMode(activeHandle, terminalModes)

  return (
    <View ref={accessoryBarKeepsKeyboard} style={styles.accessoryBar}>
      {/* Why: default tap handling makes the first accessory-key tap dismiss the keyboard and get swallowed (#5106). */}
      <View style={styles.accessoryRowsContainer}>
        {hasMultipleAccessoryRows && (
          <Pressable
            style={({ pressed }) => [
              styles.accessoryCollapseStrip,
              pressed && styles.accessoryKeyPressed
            ]}
            onPress={() => setIsAccessoryRowsCollapsed((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={
              isAccessoryRowsCollapsed
                ? 'Expand shortcut rows'
                : 'Collapse shortcut rows to single row'
            }
          >
            {isAccessoryRowsCollapsed ? (
              <ChevronUp size={12} color={colors.textSecondary} strokeWidth={2.2} />
            ) : (
              <ChevronDown size={12} color={colors.textSecondary} strokeWidth={2.2} />
            )}
          </Pressable>
        )}
        {displayedAccessoryRows.map((rowItems, rowIndex) => {
          const isFirstRow = rowIndex === 0
          const isLastRow = rowIndex === displayedAccessoryRows.length - 1
          return (
            <View
              key={`accessory-row-${displayedAccessoryRows.length}-${rowIndex}`}
              style={styles.accessoryRow}
            >
              {/* Why: fixed keyboard escape hatch; outside ScrollView + shortcut path so it can't scroll away or be hidden (#5106). */}
              {isFirstRow && keyboardLift > 0 && (
                <Pressable
                  style={({ pressed }) => [
                    styles.keyboardDismissKey,
                    pressed && styles.accessoryKeyPressed
                  ]}
                  onPress={dismissSoftwareKeyboard}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss keyboard"
                  accessibilityHint="Hides the software keyboard and keeps the current terminal session open."
                >
                  <View style={styles.keyboardDismissGlyph}>
                    <KeyboardIcon size={15} color={colors.textSecondary} strokeWidth={2} />
                    <ChevronDown
                      size={10}
                      color={colors.textSecondary}
                      strokeWidth={2.5}
                      style={styles.keyboardDismissChevron}
                    />
                  </View>
                </Pressable>
              )}
              <ScrollView
                style={styles.accessoryScroll}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.accessoryContent}
                keyboardShouldPersistTaps="always"
                onScrollBeginDrag={stopAccessoryRepeat}
              >
                {isFirstRow && (
                  <>
                    <Pressable
                      style={({ pressed }) => [
                        styles.accessoryKey,
                        pressed && styles.accessoryKeyPressed,
                        !canSend && styles.accessoryKeyDisabled
                      ]}
                      disabled={!canSend}
                      onPress={() => {
                        if (activeHandle) {
                          void toggleDisplayMode(activeHandle)
                        }
                      }}
                      accessibilityLabel={
                        isPhoneMode ? 'Switch to desktop mode' : 'Switch to phone mode'
                      }
                    >
                      {isPhoneMode ? (
                        <Monitor
                          size={14}
                          color={canSend ? colors.textSecondary : colors.textMuted}
                        />
                      ) : (
                        <Smartphone
                          size={14}
                          color={canSend ? colors.textSecondary : colors.textMuted}
                        />
                      )}
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.accessoryKey,
                        liveInputEnabled && styles.accessoryKeyActive,
                        pressed && styles.accessoryKeyPressed,
                        !canCompose && styles.accessoryKeyDisabled
                      ]}
                      // Why: offline, live mode is dead but the buffered box still composes — keep the escape hatch tappable (#6713).
                      disabled={!canCompose}
                      onPress={toggleLiveInput}
                      accessibilityLabel={
                        liveInputEnabled
                          ? 'Switch to buffered command input'
                          : 'Switch to live terminal input'
                      }
                    >
                      <ChevronsRight
                        size={14}
                        color={
                          liveInputEnabled
                            ? colors.bgBase
                            : canCompose
                              ? colors.textSecondary
                              : colors.textMuted
                        }
                      />
                    </Pressable>
                    {canPaste && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.accessoryKey,
                          pressed && styles.accessoryKeyPressed,
                          !canSend && styles.accessoryKeyDisabled
                        ]}
                        disabled={!canSend}
                        onPress={() => void handlePaste()}
                        accessibilityLabel="Paste from clipboard"
                      >
                        <Text
                          style={[
                            styles.accessoryKeyText,
                            !canSend && styles.accessoryKeyTextDisabled
                          ]}
                        >
                          Paste
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}
                {rowItems.map((item) =>
                  item.kind === 'built-in' ? (
                    <Pressable
                      key={item.key.id}
                      style={({ pressed }) => [
                        styles.accessoryKey,
                        pressed && styles.accessoryKeyPressed,
                        !canSend && styles.accessoryKeyDisabled
                      ]}
                      disabled={!canSend}
                      onPressIn={() => {
                        if (item.key.repeatable) {
                          startAccessoryRepeat(createTerminalLiveAccessoryInput(item.key))
                        }
                      }}
                      onPressOut={() => {
                        if (item.key.repeatable) {
                          stopAccessoryRepeat()
                        }
                      }}
                      onPress={() => {
                        if (item.key.repeatable && consumeAccessoryRepeatHandled()) {
                          return
                        }
                        void handleAccessoryKey(createTerminalLiveAccessoryInput(item.key))
                      }}
                      onLongPress={item.key.repeatable ? keepHeldPressThroughLongPress : undefined}
                      accessibilityLabel={item.key.accessibilityLabel ?? `Send ${item.key.label}`}
                    >
                      <Text
                        style={[
                          styles.accessoryKeyText,
                          !canSend && styles.accessoryKeyTextDisabled
                        ]}
                      >
                        {item.key.label}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      key={item.key.id}
                      style={({ pressed }) => [
                        styles.accessoryKey,
                        styles.customAccessoryKey,
                        pressed && styles.accessoryKeyPressed,
                        !canSend && styles.accessoryKeyDisabled
                      ]}
                      disabled={!canSend}
                      onPress={() => void handleAccessoryKey({ bytes: item.key.bytes })}
                      onLongPress={() => {
                        triggerMediumImpact()
                        setDeleteKeyTarget(item.key)
                      }}
                      delayLongPress={400}
                      accessibilityLabel={`Send ${item.key.label}`}
                    >
                      <Text
                        style={[
                          styles.accessoryKeyText,
                          !canSend && styles.accessoryKeyTextDisabled
                        ]}
                      >
                        {item.key.label}
                      </Text>
                    </Pressable>
                  )
                )}
                {isLastRow && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.accessoryKey,
                      pressed && styles.accessoryKeyPressed
                    ]}
                    onPress={() => setShowCustomKeyModal(true)}
                    accessibilityLabel="Add custom shortcut"
                  >
                    <Plus size={14} color={colors.textSecondary} strokeWidth={2.2} />
                  </Pressable>
                )}
              </ScrollView>
            </View>
          )
        })}
      </View>
    </View>
  )
}
