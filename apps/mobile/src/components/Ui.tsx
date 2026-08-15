import React, { PropsWithChildren, ReactNode } from 'react';
import {
  Pressable,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MainTab } from '../app/CyclePairStore';
import { colors, radius, spacing } from '../theme';

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: PropsWithChildren<{ scroll?: boolean; contentStyle?: StyleProp<ViewStyle> }>) {
  const insets = useSafeAreaInsets();
  const style = [styles.screenContent, { paddingTop: insets.top + spacing.sm }, contentStyle];

  return scroll ? (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      style={styles.screen}
      contentContainerStyle={style}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      testID="screen-scroll">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screen, style]}>{children}</View>
  );
}

export function Card({
  children,
  style,
  tone = 'default',
}: PropsWithChildren<{ style?: StyleProp<ViewStyle>; tone?: 'default' | 'primary' | 'accent' | 'mint' }>) {
  return <View style={[styles.card, cardTones[tone], style]}>{children}</View>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  compact = false,
  danger = false,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  compact?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        compact && styles.secondaryButtonCompact,
        danger && styles.dangerButton,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}>
      <Text style={[styles.secondaryButtonText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

export function TextButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={10}>
      <Text style={[styles.textButton, disabled && styles.textButtonDisabled]}>{label}</Text>
    </Pressable>
  );
}

export function Eyebrow({ children }: PropsWithChildren) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function Title({ children, style }: PropsWithChildren<{ style?: StyleProp<TextStyle> }>) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Body({
  children,
  muted = false,
  style,
}: PropsWithChildren<{ muted?: boolean; style?: StyleProp<TextStyle> }>) {
  return <Text style={[styles.body, muted && styles.bodyMuted, style]}>{children}</Text>;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  emoji,
}: {
  label: string;
  selected?: boolean;
  onPress?(): void;
  emoji?: string;
}) {
  const content = (
    <>
      {emoji ? <Text style={styles.chipEmoji}>{emoji}</Text> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </>
  );

  if (!onPress) return <View style={[styles.chip, selected && styles.chipSelected]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.buttonPressed]}>
      {content}
    </Pressable>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onValueChange,
  disabled = false,
}: {
  title: string;
  description?: string;
  value: boolean;
  onValueChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleTitle}>{title}</Text>
        {description ? <Text style={styles.toggleDescription}>{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={description}
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primarySoft }}
        thumbColor={value ? colors.primary : '#FFFFFF'}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

export function Stepper({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  onChange(value: number): void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.toggleTitle}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} 줄이기`}
          accessibilityState={{ disabled: disabled || value <= min }}
          disabled={disabled || value <= min}
          onPress={() => onChange(value - 1)}
          style={[styles.stepperButton, disabled && styles.buttonDisabled]}>
          <Text style={styles.stepperSymbol}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>
          {value}{suffix}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} 늘리기`}
          accessibilityState={{ disabled: disabled || value >= max }}
          disabled={disabled || value >= max}
          onPress={() => onChange(value + 1)}
          style={[styles.stepperButton, disabled && styles.buttonDisabled]}>
          <Text style={styles.stepperSymbol}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

const tabs: Array<{ key: MainTab; label: string; icon: string }> = [
  { key: 'home', label: '오늘', icon: '∞' },
  { key: 'calendar', label: '달력', icon: '◫' },
  { key: 'partner', label: '함께', icon: '♡' },
  { key: 'settings', label: '설정', icon: '⋯' },
];

export function BottomTabs({ value, onChange }: { value: MainTab; onChange(tab: MainTab): void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {tabs.map(tab => {
        const selected = tab.key === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={styles.tabItem}>
            <Text style={[styles.tabIcon, selected && styles.tabSelected]}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, selected && styles.tabSelected]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const cardTones = StyleSheet.create({
  default: { backgroundColor: colors.surface },
  primary: { backgroundColor: colors.primarySoft },
  accent: { backgroundColor: colors.accentSoft },
  mint: { backgroundColor: colors.mintSoft },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.huge,
  },
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#3B2F53',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 2,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  secondaryButton: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  secondaryButtonCompact: { minHeight: 40, paddingHorizontal: spacing.lg },
  secondaryButtonText: { color: colors.primaryDark, fontSize: 16, fontWeight: '700' },
  dangerButton: { borderColor: colors.dangerSoft, backgroundColor: colors.dangerSoft },
  dangerText: { color: colors.danger },
  buttonPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.45 },
  textButton: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  textButtonDisabled: { color: colors.textSubtle },
  eyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: { color: colors.text, fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -0.6 },
  body: { color: colors.text, fontSize: 16, lineHeight: 24 },
  bodyMuted: { color: colors.textMuted },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  chipTextSelected: { color: colors.primaryDark, fontWeight: '800' },
  chipEmoji: { fontSize: 18 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  toggleCopy: { flex: 1, gap: spacing.xs },
  toggleTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  toggleDescription: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperSymbol: { color: colors.primaryDark, fontSize: 20, fontWeight: '700' },
  stepperValue: { minWidth: 54, color: colors.text, fontSize: 16, textAlign: 'center', fontWeight: '800' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 52 },
  tabIcon: { color: colors.textSubtle, fontSize: 23, fontWeight: '600' },
  tabLabel: { color: colors.textSubtle, fontSize: 11, fontWeight: '700' },
  tabSelected: { color: colors.primaryDark },
});
