import { View, Text } from 'react-native'
import { Minus, Plus } from 'lucide-react-native'
import type Animated from 'react-native-reanimated'
import type { AnimatedRef, SharedValue } from 'react-native-reanimated'
import { SettingsSection } from '../settings/settings-screen-frame'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { CustomKeyModal } from './CustomKeyModal'
import { DragReorderList } from './DragReorderList'
import { ListRow } from './list/ListGroup'
import { MobileSwitch } from './MobileSwitch'
import {
  ShortcutRowHeader,
  ShortcutRowStepButton,
  TerminalShortcutReorderRow
} from './terminal-shortcut-reorder-row'
import { useTerminalShortcutEditor } from './terminal-shortcut-settings-editor'
import { styles, TERMINAL_SHORTCUT_REORDER_ROW_HEIGHT } from './terminal-shortcut-settings-styles'

type Props = {
  scrollRef: AnimatedRef<Animated.ScrollView>
  scrollOffsetY: SharedValue<number>
  scrollContentHeight: SharedValue<number>
  onDragActiveChange: (active: boolean) => void
}

export function TerminalShortcutSettings({
  scrollRef,
  scrollOffsetY,
  scrollContentHeight,
  onDragActiveChange
}: Props): React.JSX.Element {
  useMobileColorScheme()
  const editor = useTerminalShortcutEditor()
  const visibleBuiltIns = new Set(editor.visibleBuiltInIds)

  return (
    <>
      {editor.hasPad ? (
        <SettingsSection
          title={editor.t('components.terminalShortcutSettings.directionPad', 'DIRECTION PAD')}
        >
          <ListRow
            key="directionPad"
            title={editor.t('components.terminalShortcutSettings.showDirectionPad', 'Show D-pad')}
            subtitle={editor.t(
              'components.terminalShortcutSettings.showDirectionPadDescription',
              'Pin the arrow pad in the side rail. Without it, the rail lists the arrow keys.'
            )}
            accessory={
              <MobileSwitch
                accessibilityLabel={editor.t(
                  'components.terminalShortcutSettings.showDirectionPad',
                  'Show D-pad'
                )}
                disabled={!editor.canEdit}
                value={editor.directionPadEnabled}
                onValueChange={editor.toggleDirectionPad}
              />
            }
          />
        </SettingsSection>
      ) : null}
      <SettingsSection
        title={editor.t('components.terminalShortcutSettings.shortcutBar', 'SHORTCUT BAR')}
        footer={editor.t(
          'components.terminalShortcutSettings.shortcutBarDescription',
          'Toggle keys to show or hide them, and hold the grip to drag built-in or custom shortcuts into any order or row on the terminal shortcut bar.'
        )}
      >
        <ListRow
          key="rows"
          title={editor.t('components.terminalShortcutSettings.shortcutRows', 'Shortcut Rows')}
          subtitle={editor.t(
            'components.terminalShortcutSettings.shortcutRowsDescription',
            'Stack shortcut keys across 1 to 4 rows'
          )}
          accessory={
            <View style={styles.stepper}>
              <ShortcutRowStepButton
                enabled={editor.canDecreaseRows}
                label={editor.t(
                  'components.terminalShortcutSettings.decreaseRows',
                  'Decrease shortcut rows'
                )}
                icon={Minus}
                onPress={() => editor.setRowCount(-1)}
              />
              <Text style={styles.stepperValue}>{editor.rowCount}</Text>
              <ShortcutRowStepButton
                enabled={editor.canIncreaseRows}
                label={editor.t(
                  'components.terminalShortcutSettings.increaseRows',
                  'Increase shortcut rows'
                )}
                icon={Plus}
                onPress={() => editor.setRowCount(1)}
              />
            </View>
          }
        />
        {editor.rowCount > 1 ? <ShortcutRowHeader label="ROW 1" /> : null}
        <DragReorderList
          items={editor.unifiedItems}
          itemKey={(item) => item.id}
          rowHeight={TERMINAL_SHORTCUT_REORDER_ROW_HEIGHT}
          isItemDraggable={(item) => editor.canEdit && item.kind !== 'row-divider'}
          scrollRef={scrollRef}
          scrollOffsetY={scrollOffsetY}
          scrollContentHeight={scrollContentHeight}
          onDragActiveChange={onDragActiveChange}
          onReorder={editor.reorder}
          renderRow={(item) => (
            <TerminalShortcutReorderRow
              item={item}
              canEdit={editor.canEdit}
              builtInVisible={item.kind === 'built-in' && visibleBuiltIns.has(item.shortcutKey.id)}
              showLabel={editor.showLabel}
              onToggleBuiltIn={editor.toggleBuiltIn}
              onToggleCustomVisible={editor.setCustomVisibility}
              onEditCustom={editor.openEditor}
              onDeleteCustom={editor.removeCustomKey}
            />
          )}
        />
        <ListRow
          key="add"
          title={editor.t(
            'components.terminalShortcutSettings.addShortcut',
            'Add Custom Shortcut…'
          )}
          subtitle={editor.t(
            'components.terminalShortcutSettings.addDescription',
            'Create key combo or text macro'
          )}
          navigates
          disabled={!editor.canEdit}
          onPress={() => editor.openEditor(null)}
        />
        <ListRow
          key="reset"
          title={editor.t('components.terminalShortcutSettings.resetDefaults', 'Reset Defaults')}
          subtitle={editor.t(
            'components.terminalShortcutSettings.resetDescription',
            'Show every built-in shortcut key in the original order'
          )}
          disabled={!editor.canEdit}
          onPress={editor.resetLayout}
        />
      </SettingsSection>
      <CustomKeyModal
        visible={editor.showCustomKeyModal}
        editingKey={editor.editingCustomKey}
        onClose={editor.closeEditor}
        onKeysChanged={editor.applyStoredCustomKeys}
      />
    </>
  )
}
