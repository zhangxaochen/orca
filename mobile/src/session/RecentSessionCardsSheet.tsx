import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { File, FileText, Globe, LocateFixed, SquareTerminal } from 'lucide-react-native'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import { BottomDrawer } from '../components/BottomDrawer'
import { useNow } from '../hooks/use-now'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { formatTimeAgo } from '../worktree/agent-row-display'
import {
  MAX_RECENT_SESSION_CARDS_DISPLAY,
  type RecentSessionCardRecord
} from './recent-session-cards'
import { getWorktreeLabel } from './worktree-label'

export type RecentSessionCardsSectionProps = {
  cards: readonly RecentSessionCardRecord[]
  jumpingCardKey: string | null
  currentWorktreeId?: string
  currentTabId?: string | null
  onSelectCard: (card: RecentSessionCardRecord) => void
}

export type RecentSessionCardsSheetProps = RecentSessionCardsSectionProps & {
  visible: boolean
  onClose: () => void
}

export const MAX_RECENT_CARD_WORKSPACE_LABEL_CHARS = 16

function recentCardKey(card: RecentSessionCardRecord): string {
  return `${card.worktreeId}:${card.tabId}`
}

export function formatWorkspaceBadgeLabel(label: string): string {
  if (label.length <= MAX_RECENT_CARD_WORKSPACE_LABEL_CHARS) {
    return label
  }
  const slashIndex = label.lastIndexOf('/')
  if (slashIndex > 0 && slashIndex < label.length - 1) {
    const prefix = label
      .slice(0, slashIndex)
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => segment[0])
      .join('/')
    const suffix = label.slice(slashIndex + 1)
    const compactCandidate = `${prefix}/${suffix}`
    if (compactCandidate.length <= MAX_RECENT_CARD_WORKSPACE_LABEL_CHARS) {
      return compactCandidate
    }
    const remainingTailChars = MAX_RECENT_CARD_WORKSPACE_LABEL_CHARS - prefix.length - 2
    if (remainingTailChars > 0) {
      return `${prefix}/…${suffix.slice(-remainingTailChars)}`
    }
  }
  return `…${label.slice(-(MAX_RECENT_CARD_WORKSPACE_LABEL_CHARS - 1))}`
}

function RecentCardIcon({ card }: { card: RecentSessionCardRecord }) {
  if (card.agentId) {
    return <MobileAgentIcon agentId={card.agentId} size={16} />
  }
  if (card.tabType === 'browser') {
    return <Globe size={16} color={colors.textSecondary} />
  }
  if (card.tabType === 'markdown') {
    return <FileText size={16} color={colors.textSecondary} />
  }
  if (card.tabType === 'file') {
    return <File size={16} color={colors.textSecondary} />
  }
  return <SquareTerminal size={16} color={colors.textSecondary} />
}

export function RecentSessionCardsSection({
  cards,
  jumpingCardKey,
  currentWorktreeId,
  currentTabId,
  onSelectCard
}: RecentSessionCardsSectionProps) {
  const now = useNow(30_000)
  const visibleCards = cards.slice(0, MAX_RECENT_SESSION_CARDS_DISPLAY)
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>Recently Used</Text>
      </View>
      <View style={styles.panel}>
        {visibleCards.length === 0 ? (
          <Text style={styles.emptyText}>No other recent cards yet</Text>
        ) : (
          visibleCards.map((card, index) => {
            const workspaceLabel = getWorktreeLabel(card.worktreeName, card.worktreeId)
            const badgeLabel = formatWorkspaceBadgeLabel(workspaceLabel)
            const key = recentCardKey(card)
            const timeAgo = formatTimeAgo(card.lastVisitedAt, now)
            const isCurrentWorkspace =
              Boolean(currentWorktreeId) && card.worktreeId === currentWorktreeId
            const isCurrentCard =
              isCurrentWorkspace && Boolean(currentTabId) && card.tabId === currentTabId
            return (
              <View key={key}>
                {index > 0 ? <View style={styles.separator} /> : null}
                <Pressable
                  testID={`recent-session-card-${card.worktreeId}-${card.tabId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${card.title}, ${workspaceLabel}`}
                  disabled={jumpingCardKey !== null}
                  onPress={() => onSelectCard(card)}
                  style={({ pressed }) => [
                    styles.row,
                    isCurrentCard && styles.rowCurrentCard,
                    pressed && styles.rowPressed
                  ]}
                >
                  <RecentCardIcon card={card} />
                  <View style={styles.textBlock}>
                    <Text
                      style={[styles.cardTitle, isCurrentCard && styles.cardTitleCurrent]}
                      numberOfLines={1}
                    >
                      {card.title}
                    </Text>
                    <View style={styles.metaRow}>
                      <View style={styles.workspaceBadge}>
                        {isCurrentWorkspace ? (
                          <View
                            testID={`recent-session-card-current-dot-${card.worktreeId}-${card.tabId}`}
                            style={styles.currentWorkspaceDot}
                          />
                        ) : null}
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          style={[
                            styles.workspaceBadgeText,
                            isCurrentWorkspace && styles.workspaceBadgeTextCurrent
                          ]}
                        >
                          {badgeLabel}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {jumpingCardKey === key ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : isCurrentCard ? (
                    <View
                      testID={`recent-session-card-current-icon-${card.worktreeId}-${card.tabId}`}
                    >
                      <LocateFixed size={15} color={colors.accentBlue} />
                    </View>
                  ) : (
                    <Text style={styles.timeText}>{timeAgo}</Text>
                  )}
                </Pressable>
              </View>
            )
          })
        )}
      </View>
    </View>
  )
}

export function RecentSessionCardsSheet({
  visible,
  cards,
  jumpingCardKey,
  currentWorktreeId,
  currentTabId,
  onSelectCard,
  onClose
}: RecentSessionCardsSheetProps) {
  return (
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss>
      <RecentSessionCardsSection
        cards={cards}
        jumpingCardKey={jumpingCardKey}
        currentWorktreeId={currentWorktreeId}
        currentTabId={currentTabId}
        onSelectCard={onSelectCard}
      />
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.md
  },
  header: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted
  },
  panel: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden'
  },
  emptyText: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: typography.metaSize,
    color: colors.textSecondary,
    textAlign: 'center'
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  rowCurrentCard: {
    backgroundColor: colors.bgRaised
  },
  textBlock: {
    flex: 1,
    minWidth: 0
  },
  cardTitle: {
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  cardTitleCurrent: {
    fontWeight: '600'
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2
  },
  workspaceBadge: {
    flexShrink: 1,
    maxWidth: 132,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgRaised,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1
  },
  currentWorkspaceDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.accentBlue
  },
  workspaceBadgeText: {
    flexShrink: 1,
    fontSize: typography.metaSize,
    color: colors.textSecondary
  },
  workspaceBadgeTextCurrent: {
    color: colors.accentBlue,
    fontWeight: '600'
  },
  timeText: {
    flexShrink: 0,
    fontSize: typography.metaSize,
    color: colors.textMuted,
    textAlign: 'right'
  }
})
