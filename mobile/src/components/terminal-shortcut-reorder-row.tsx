import { Pressable, Text, View } from 'react-native'
import { Minus, X } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import type { UnifiedShortcutItem } from './terminal-shortcut-settings-layout'
import { styles } from './terminal-shortcut-settings-styles'
import { MobileSwitch } from './MobileSwitch'

export function ShortcutRowHeader({ label }: { label: string }): React.JSX.Element {
  useMobileColorScheme()
  return (
    <View style={styles.rowDividerContent}>
      <Text style={styles.rowHeaderText}>{label}</Text>
    </View>
  )
}

export function ShortcutRowStepButton({
  enabled,
  label,
  icon: Icon,
  onPress
}: {
  enabled: boolean
  label: string
  icon: typeof Minus
  onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.stepperButton,
        pressed && enabled && styles.stepperButtonPressed,
        !enabled && styles.stepperButtonDisabled
      ]}
      disabled={!enabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon size={15} color={enabled ? colors.textPrimary : colors.textMuted} strokeWidth={2.2} />
    </Pressable>
  )
}

export function TerminalShortcutReorderRow({
  item,
  canEdit,
  builtInVisible,
  showLabel,
  onToggleBuiltIn,
  onToggleCustomVisible,
  onEditCustom,
  onDeleteCustom
}: {
  item: UnifiedShortcutItem
  canEdit: boolean
  builtInVisible: boolean
  showLabel: (label: string) => string
  onToggleBuiltIn: (id: string, visible: boolean) => void
  onToggleCustomVisible: (id: string, visible: boolean) => void
  onEditCustom: (key: Extract<UnifiedShortcutItem, { kind: 'custom' }>['customKey']) => void
  onDeleteCustom: (id: string) => void
}): React.JSX.Element {
  useMobileColorScheme()
  if (item.kind === 'row-divider') {
    return <ShortcutRowHeader label={`ROW ${item.rowNumber}`} />
  }
  if (item.kind === 'built-in') {
    const label = item.shortcutKey.accessibilityLabel ?? item.shortcutKey.label
    return (
      <View style={styles.reorderRowContent}>
        <ShortcutIdentity keycap={item.shortcutKey.label} title={label} />
        <MobileSwitch
          accessibilityLabel={showLabel(label)}
          disabled={!canEdit}
          value={builtInVisible}
          onValueChange={(visible) => onToggleBuiltIn(item.shortcutKey.id, visible)}
        />
      </View>
    )
  }
  return (
    <View style={styles.reorderRowContent}>
      <Pressable
        disabled={!canEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${item.customKey.label}`}
        onPress={() => onEditCustom(item.customKey)}
        style={styles.editTarget}
      >
        <ShortcutIdentity
          keycap={item.customKey.label}
          title={item.customKey.label}
          sublabel={item.customKey.bytes.replace(/\r/g, ' ↵')}
        />
      </Pressable>
      <MobileSwitch
        accessibilityLabel={showLabel(item.customKey.label)}
        disabled={!canEdit}
        value={item.customKey.visible !== false}
        onValueChange={(visible) => onToggleCustomVisible(item.customKey.id, visible)}
      />
      <Pressable
        disabled={!canEdit}
        style={({ pressed }) => [
          styles.deleteButton,
          pressed && canEdit && styles.deleteButtonPressed
        ]}
        onPress={() => onDeleteCustom(item.id)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${item.customKey.label}`}
      >
        <X size={16} color={colors.statusRed} />
      </Pressable>
    </View>
  )
}

function ShortcutIdentity({
  keycap,
  title,
  sublabel
}: {
  keycap: string
  title: string
  sublabel?: string
}): React.JSX.Element {
  return (
    <>
      <View style={styles.keycap}>
        <Text style={styles.keycapText}>{keycap}</Text>
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{title}</Text>
        {sublabel ? (
          <Text style={styles.rowSublabel} numberOfLines={1} ellipsizeMode="tail">
            {sublabel}
          </Text>
        ) : null}
      </View>
    </>
  )
}
