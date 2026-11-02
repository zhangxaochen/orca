import { colors, feedback, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { LIST_ROW_PADDING } from './list/ListGroup'

// Drag-reorder rows keep their own layout: the reorder list fixes their height and adds the grip.
export const TERMINAL_SHORTCUT_REORDER_ROW_HEIGHT = 56

export const styles = themedStyleSheet(() => ({
  reorderRowContent: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: LIST_ROW_PADDING
  },
  rowContent: {
    flex: 1,
    minWidth: 0
  },
  rowLabel: {
    fontSize: 15,
    color: colors.textPrimary
  },
  rowSublabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2
  },
  keycap: {
    minWidth: 62,
    alignItems: 'center',
    backgroundColor: colors.translucentFill,
    borderRadius: radii.control,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  keycapText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily
  },
  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.translucentFill
  },
  deleteButtonPressed: {
    opacity: feedback.pressedOpacity
  },
  editTarget: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  rowDividerContent: {
    height: TERMINAL_SHORTCUT_REORDER_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.md + 2,
    backgroundColor: colors.bgBase
  },
  rowHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.5
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: radii.control,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepperButtonPressed: {
    backgroundColor: colors.borderSubtle
  },
  stepperButtonDisabled: {
    opacity: 0.35
  },
  stepperValue: {
    minWidth: 20,
    textAlign: 'center',
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary,
    fontFamily: typography.monoFamily
  }
}))
