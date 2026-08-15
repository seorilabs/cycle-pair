import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { InAppNotice } from '../app/inAppNotifications';
import { colors, radius, spacing } from '../theme';

export function InAppToast({
  notice,
  onDismiss,
  onOpen,
}: {
  notice: InAppNotice | null;
  onDismiss(): void;
  onOpen(noticeId: string): void;
}) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(onDismiss, 4_000);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.toastLayer, { top: insets.top + spacing.sm }]}
    >
      <Pressable
        accessibilityLabel={`${notice.message} 확인하기`}
        accessibilityLiveRegion="polite"
        accessibilityRole="button"
        onPress={() => onOpen(notice.id)}
        style={({ pressed }) => [styles.toast, pressed && styles.pressed]}
      >
        <View style={styles.iconBubble}>
          <Text style={styles.icon}>♡</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.toastLabel}>새 소식</Text>
          <Text style={styles.message}>{notice.message}</Text>
        </View>
        <Text style={styles.openLabel}>열기</Text>
      </Pressable>
    </View>
  );
}

export function InAppMessageBox({
  notice,
  count,
  onOpen,
}: {
  notice: InAppNotice;
  count: number;
  onOpen(noticeId: string): void;
}) {
  return (
    <View style={styles.messageBoxShell}>
      <Pressable
        accessibilityLabel={`새 소식 ${count}개. ${notice.message} 확인하기`}
        accessibilityRole="button"
        onPress={() => onOpen(notice.id)}
        style={({ pressed }) => [styles.messageBox, pressed && styles.pressed]}
      >
        <View style={styles.unreadDot} />
        <View style={styles.copy}>
          <Text style={styles.boxLabel}>새 소식 {count}개</Text>
          <Text numberOfLines={1} style={styles.boxMessage}>
            {notice.message}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toastLayer: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 20,
    elevation: 12,
  },
  toast: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  iconBubble: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
  },
  icon: { color: colors.primaryDark, fontSize: 20, fontWeight: '900' },
  copy: { flex: 1, gap: 2 },
  toastLabel: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  message: { color: colors.text, fontSize: 14, fontWeight: '800' },
  openLabel: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  messageBoxShell: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  messageBox: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  boxLabel: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  boxMessage: { color: colors.text, fontSize: 13, fontWeight: '700' },
  chevron: { color: colors.primary, fontSize: 26, fontWeight: '500' },
});
