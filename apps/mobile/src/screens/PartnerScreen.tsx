import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { buildCycleViewModel, formatKoreanDate } from '../app/cycleViewModel';
import { useCyclePair } from '../app/CyclePairStore';
import { Body, Card, Chip, PrimaryButton, Screen, SectionHeader, Title } from '../components/Ui';
import { colors, spacing } from '../theme';

export function PartnerScreen() {
  const { state, openPairing, continueToSharing } = useCyclePair();
  const [acknowledged, setAcknowledged] = useState(false);
  const viewModel = buildCycleViewModel(state);

  if (!state.paired) {
    return (
      <Screen contentStyle={styles.content}>
        <Text style={styles.soloEyebrow}>선택 기능</Text>
        <Title>혼자 기록하다가{`\n`}필요할 때 연결해요</Title>
        <Body muted style={styles.soloIntro}>
          주기와 오늘의 컨디션은 파트너 없이도 계속 관리할 수 있어요.
        </Body>

        <Card tone="primary" style={styles.soloCard}>
          <View style={styles.soloIcon}><Text style={styles.soloIconText}>♡</Text></View>
          <Text style={styles.soloTitle}>한 사람과 선택적으로 공유</Text>
          <Text style={styles.soloBody}>
            상대가 초대를 수락한 뒤에도 기본값은 비공개예요. 보여줄 항목은 직접 고릅니다.
          </Text>
          <PrimaryButton label="파트너 연결하기" onPress={openPairing} />
        </Card>

        <Card style={styles.soloPrivacyCard}>
          <Text style={styles.privacyTitle}>지금은 내 기록만 저장돼요</Text>
          <Text style={styles.privacyBody}>
            연결 전에는 partner projection이 만들어지지 않고 다른 사용자가 내 기록을 볼 수 없습니다.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (!state.sharingCompleted) {
    return (
      <Screen contentStyle={styles.content}>
        <Text style={styles.soloEyebrow}>연결 완료</Text>
        <Title>보여줄 항목을{`\n`}직접 선택해 주세요</Title>
        <Body muted style={styles.soloIntro}>
          Pair는 연결됐지만 아직 어떤 건강 정보도 공유되지 않았어요.
        </Body>
        <Card tone="primary" style={styles.soloCard}>
          <Text style={styles.soloTitle}>기본값은 모두 비공개</Text>
          <Text style={styles.soloBody}>
            공유 설정을 마친 뒤에도 언제든 항목별로 다시 끌 수 있습니다.
          </Text>
          <PrimaryButton label="공유 설정 계속하기" onPress={continueToSharing} />
        </Card>
      </Screen>
    );
  }

  const remote = state.partnerProjection;
  const moodCopy: Record<string, string> = {
    'very-low': '오늘은 많이 힘들어요',
    low: '오늘은 조금 지쳐 있어요',
    neutral: '오늘은 괜찮아요',
    good: '오늘은 기분이 좋아요',
    'very-good': '오늘은 아주 좋아요',
  };
  const preferenceCopy: Record<string, { title: string; body: string }> = {
    listen: { title: '그냥 이야기를 들어주세요', body: '해결책보다 편하게 들어주는 것이 좋아요.' },
    'quiet-space': { title: '조용히 쉴 시간을 주세요', body: '답을 재촉하지 않고 쉬도록 배려해 주세요.' },
    warmth: { title: '따뜻하게 챙겨주세요', body: '따뜻한 음료나 찜질팩이 필요한지 가볍게 물어보세요.' },
    'no-action': { title: '평소처럼 대해주세요', body: '특별히 추측하거나 과하게 챙기지 않는 것이 좋아요.' },
  };
  const preference = remote?.carePreferences?.[0]
    ? preferenceCopy[remote.carePreferences[0]]
    : undefined;
  const sharedLabels = [
    remote?.moodTag ? '기분' : undefined,
    remote?.symptomTags?.length ? '증상' : undefined,
    remote?.carePreferences?.length ? '원하는 도움' : undefined,
    remote?.cyclePhase ? '주기 국면' : undefined,
    remote?.nextPeriodWindow ? '다음 예상 범위' : undefined,
    remote?.periodDates ? '생리 날짜' : undefined,
  ].filter((value): value is string => Boolean(value));

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>파</Text></View>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>연결된 파트너</Text>
          <Text style={styles.title}>{state.partnerName} 님의 오늘</Text>
          <Text style={styles.updated}>{formatKoreanDate(viewModel.partnerProjection.asOf)} 기준 · 직접 공유</Text>
        </View>
      </View>

      <Card tone="accent" style={styles.statusCard}>
        <Text style={styles.quote}>“</Text>
        <Text style={styles.statusTitle}>{remote?.moodTag ? moodCopy[remote.moodTag] ?? '공유된 기분이 있어요' : '아직 공유된 오늘 정보가 없어요'}</Text>
        <Text style={styles.statusBody}>{remote ? `주기만으로 추측하지 않고 ${state.partnerName} 님이 허용한 항목만 표시해요.` : '상대가 공유할 항목을 선택하면 이 화면에 나타나요.'}</Text>
        <View style={styles.sharedChips}>
          {sharedLabels.map(label => <Chip key={label} label={label} />)}
        </View>
      </Card>

      <SectionHeader title="원하는 도움" />
      <Card tone="mint" style={styles.preferenceCard}>
        <View style={styles.preferenceIcon}><Text style={styles.preferenceIconText}>♡</Text></View>
        <View style={styles.preferenceCopy}>
          <Text style={styles.preferenceTitle}>{preference?.title ?? '직접 필요한 것을 물어봐 주세요'}</Text>
          <Text style={styles.preferenceBody}>{preference?.body ?? '공유된 도움 선호가 없을 때는 추측하지 않는 것이 가장 안전해요.'}</Text>
        </View>
      </Card>

      <SectionHeader title="오늘의 케어 힌트" />
      <Card style={styles.tipCard}>
        <View style={styles.tipNumber}><Text style={styles.tipNumberText}>1</Text></View>
        <View style={styles.tipCopy}>
          <Text style={styles.tipTitle}>{viewModel.careTip.title}</Text>
          <Text style={styles.tipBody}>{viewModel.careTip.body}</Text>
        </View>
      </Card>
      <Card style={styles.tipCard}>
        <View style={styles.tipNumber}><Text style={styles.tipNumberText}>2</Text></View>
        <View style={styles.tipCopy}>
          <Text style={styles.tipTitle}>답이 없어도 재촉하지 않기</Text>
          <Text style={styles.tipBody}>케어 힌트는 명령이 아니에요. 상대의 실제 반응과 경계를 항상 먼저 존중해 주세요.</Text>
        </View>
      </Card>

      <View style={styles.action}>
        <PrimaryButton
          label={acknowledged ? '마음으로 응원했어요 ✓' : '오늘 챙겨볼게요'}
          onPress={() => setAcknowledged(true)}
          disabled={acknowledged}
        />
        <Body muted style={styles.actionNote}>이 행동은 파트너에게 알림을 보내지 않아요.</Body>
      </View>

      <Card tone="primary" style={styles.privacyCard}>
        <Text style={styles.privacyTitle}>보이지 않는 정보가 있는 것이 정상이에요</Text>
        <Text style={styles.privacyBody}>상대가 공유하지 않은 날짜·증상·메모는 이 화면의 데이터에도 포함되지 않습니다.</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  soloEyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', marginBottom: spacing.sm },
  soloIntro: { marginTop: spacing.md },
  soloCard: { alignItems: 'stretch', gap: spacing.md, marginTop: spacing.xl },
  soloIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  soloIconText: { color: colors.primary, fontSize: 31 },
  soloTitle: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
  soloBody: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  soloPrivacyCard: { gap: spacing.xs, marginTop: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.xl },
  avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  title: { color: colors.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.4 },
  updated: { color: colors.textMuted, fontSize: 11 },
  statusCard: { padding: spacing.xl },
  quote: { color: colors.accent, fontSize: 42, lineHeight: 35, fontWeight: '900' },
  statusTitle: { color: colors.text, fontSize: 21, fontWeight: '900', marginTop: spacing.sm },
  statusBody: { color: colors.textMuted, fontSize: 13, lineHeight: 20, marginTop: spacing.sm },
  sharedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  preferenceCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  preferenceIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  preferenceIconText: { color: colors.mint, fontSize: 27 },
  preferenceCopy: { flex: 1, gap: spacing.xs },
  preferenceTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  preferenceBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  tipCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md },
  tipNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  tipNumberText: { color: colors.primaryDark, fontSize: 12, fontWeight: '900' },
  tipCopy: { flex: 1, gap: spacing.xs },
  tipTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  tipBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  action: { gap: spacing.sm, marginTop: spacing.lg },
  actionNote: { fontSize: 11, textAlign: 'center' },
  privacyCard: { marginTop: spacing.xl, gap: spacing.xs },
  privacyTitle: { color: colors.primaryDark, fontSize: 14, fontWeight: '900' },
  privacyBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
