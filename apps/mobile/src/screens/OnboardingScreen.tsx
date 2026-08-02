import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCyclePair } from '../app/CyclePairStore';
import { useHardwareBack } from '../app/useHardwareBack';
import { Body, Eyebrow, PrimaryButton, Screen, TextButton, Title } from '../components/Ui';
import { colors, radius, spacing } from '../theme';

const pages = [
  {
    eyebrow: '둘이 함께, 원하는 만큼만',
    title: '말하지 않아도\n서로를 이해하도록',
    body: '주기와 오늘의 컨디션을 직접 고른 범위만 공유해요.',
    visual: '∞',
    bubbles: ['내 주기', '파트너 케어'],
  },
  {
    eyebrow: '프라이버시가 먼저예요',
    title: '무엇을 보여줄지는\n언제나 내가 정해요',
    body: '날짜, 기분, 증상, 도움 선호를 각각 따로 켜고 끌 수 있어요.',
    visual: '◐',
    bubbles: ['필드별 선택', '언제든 변경'],
  },
  {
    eyebrow: '의학 조언이 아닌 관계의 힌트',
    title: '오늘 필요한 배려를\n부담 없이 나눠요',
    body: '실제 공유한 컨디션과 도움 선호를 먼저 보고, 구체적인 행동을 제안해요.',
    visual: '♡',
    bubbles: ['중립 알림', '함께 준비'],
  },
] as const;

export function OnboardingScreen() {
  const { completeOnboarding } = useCyclePair();
  const [pageIndex, setPageIndex] = useState(0);
  const page = pages[pageIndex];
  const isLast = pageIndex === pages.length - 1;
  const goToPreviousPage = useCallback(() => {
    if (pageIndex === 0) return false;
    setPageIndex(current => current - 1);
    return true;
  }, [pageIndex]);

  useHardwareBack(goToPreviousPage);

  return (
    <Screen scroll={false} contentStyle={styles.content}>
      <View style={styles.topRow}>
        <View style={styles.brand}>
          <Text style={styles.brandMark}>∞</Text>
          <Text style={styles.brandText}>사이클 페어</Text>
        </View>
        <View style={styles.topActions}>
          {pageIndex > 0 ? <TextButton label="이전" onPress={goToPreviousPage} /> : null}
          {!isLast ? <TextButton label="건너뛰기" onPress={completeOnboarding} /> : null}
        </View>
      </View>

      <View style={styles.visualWrap}>
        <View style={styles.orbitLarge} />
        <View style={styles.orbitSmall} />
        <View style={styles.visualCircle}>
          <Text style={styles.visual}>{page.visual}</Text>
        </View>
        <View style={[styles.bubble, styles.bubbleLeft]}>
          <Text style={styles.bubbleText}>{page.bubbles[0]}</Text>
        </View>
        <View style={[styles.bubble, styles.bubbleRight]}>
          <Text style={styles.bubbleText}>{page.bubbles[1]}</Text>
        </View>
      </View>

      <View style={styles.copy}>
        <Eyebrow>{page.eyebrow}</Eyebrow>
        <Title>{page.title}</Title>
        <Body muted>{page.body}</Body>
      </View>

      <View style={styles.bottom}>
        <View style={styles.dots}>
          {pages.map((_, index) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${index + 1}번째 안내`}
              key={index}
              onPress={() => setPageIndex(index)}
              style={[styles.dot, index === pageIndex && styles.dotActive]}
            />
          ))}
        </View>
        <PrimaryButton
          label={isLast ? '내 방식대로 시작하기' : '다음'}
          onPress={() => (isLast ? completeOnboarding() : setPageIndex(pageIndex + 1))}
          testID="onboarding-next"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandMark: { color: colors.primary, fontSize: 28, fontWeight: '800' },
  brandText: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  visualWrap: { flex: 1, minHeight: 270, alignItems: 'center', justifyContent: 'center' },
  visualCircle: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 7,
  },
  visual: { color: '#FFFFFF', fontSize: 72, lineHeight: 86, fontWeight: '500' },
  orbitLarge: {
    position: 'absolute',
    width: 235,
    height: 235,
    borderRadius: 118,
    borderWidth: 1,
    borderColor: colors.primarySoft,
  },
  orbitSmall: {
    position: 'absolute',
    width: 184,
    height: 184,
    borderRadius: 92,
    borderWidth: 18,
    borderColor: '#F2EDF9',
  },
  bubble: {
    position: 'absolute',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleLeft: { left: 12, top: '36%' },
  bubbleRight: { right: 4, bottom: '25%' },
  bubbleText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  copy: { gap: spacing.md, paddingBottom: spacing.xl },
  bottom: { gap: spacing.xl },
  dots: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 26, backgroundColor: colors.primary },
});
