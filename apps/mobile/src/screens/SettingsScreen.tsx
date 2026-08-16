import { isLocalDate } from '@cyclepair/product-core';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CycleSeed, ShareField, useCyclePair } from '../app/CyclePairStore';
import { AccountSettingsCard } from '../components/AccountSettingsCard';
import { PrivacyCenterModal } from '../components/PrivacyCenterModal';
import { SubscriptionSettingsCard } from '../components/SubscriptionSettingsCard';
import { useSubscription } from '../app/subscription/SubscriptionContext';
import { shouldShowSubscriptionEntry } from '../app/subscription/subscriptionVisibility';
import {
  Card,
  Chip,
  PrimaryButton,
  Screen,
  SectionHeader,
  SecondaryButton,
  Stepper,
  TextButton,
  ToggleRow,
} from '../components/Ui';
import { colors, spacing } from '../theme';

const shareRows: Array<{ key: ShareField; label: string }> = [
  { key: 'cyclePhase', label: '현재 주기 국면' },
  { key: 'cycleStatus', label: '세부 생리 상태' },
  { key: 'fertilityStatus', label: '가임 가능 시기' },
  { key: 'predictedPeriod', label: '다음 생리 예상 범위' },
  { key: 'periodDates', label: '실제 생리 날짜' },
  { key: 'mood', label: '오늘의 기분' },
  { key: 'symptoms', label: '증상' },
  { key: 'energy', label: '에너지 정도' },
  { key: 'condition', label: '오늘의 컨디션' },
  { key: 'carePreference', label: '원하는 도움' },
  { key: 'note', label: '오늘의 메모' },
];

function SettingLink({
  title,
  description,
  onPress,
  danger = false,
  disabled = false,
}: {
  title: string;
  description?: string;
  onPress(): void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.linkRow, disabled && styles.disabled]}
    >
      <View style={styles.linkCopy}>
        <Text style={[styles.linkTitle, danger && styles.danger]}>{title}</Text>
        {description ? (
          <Text style={styles.linkDescription}>{description}</Text>
        ) : null}
      </View>
      <Text style={[styles.chevron, danger && styles.danger]}>›</Text>
    </Pressable>
  );
}

function localToday(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function SettingsScreen() {
  const { state: subscriptionState } = useSubscription();
  const {
    state,
    backendKind,
    backendBusy,
    notificationBusy,
    diagnosticsBusy,
    backendError,
    openPairing,
    continueToSharing,
    toggleShare,
    updatePrivateSetup,
    toggleNotifications,
    updateNotificationQuietHours,
    toggleDiagnostics,
    disconnectPair,
    resetApp,
  } = useCyclePair();
  const [quietStart, setQuietStart] = useState(
    state.notificationQuietHours.start,
  );
  const [quietEnd, setQuietEnd] = useState(state.notificationQuietHours.end);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [cycleEditing, setCycleEditing] = useState(false);
  const [cycleRecords, setCycleRecords] = useState(state.isLogger);
  const [hasCycleSeed, setHasCycleSeed] = useState(state.hasCycleSeed);
  const [cycleSeed, setCycleSeed] = useState<CycleSeed>(state.seed);
  const cycleSubmittingRef = useRef(false);
  const today = localToday();
  const cycleDateValid =
    !cycleRecords ||
    !hasCycleSeed ||
    (isLocalDate(cycleSeed.lastPeriodStart) &&
      cycleSeed.lastPeriodStart <= today);
  const selectedCount = Object.values(state.shareSettings).filter(
    Boolean,
  ).length;
  const showSubscription = shouldShowSubscriptionEntry(subscriptionState);

  useEffect(() => {
    setQuietStart(state.notificationQuietHours.start);
    setQuietEnd(state.notificationQuietHours.end);
  }, [state.notificationQuietHours]);

  useEffect(() => {
    if (cycleEditing) return;
    setCycleRecords(state.isLogger);
    setHasCycleSeed(state.hasCycleSeed);
    setCycleSeed(state.seed);
  }, [cycleEditing, state.hasCycleSeed, state.isLogger, state.seed]);

  async function saveCycleSetup() {
    if (cycleSubmittingRef.current || backendBusy || !cycleDateValid) return;
    cycleSubmittingRef.current = true;
    try {
      if (
        await updatePrivateSetup({
          isLogger: cycleRecords,
          ...(cycleRecords && hasCycleSeed ? { seed: cycleSeed } : {}),
        })
      ) {
        setCycleEditing(false);
      }
    } finally {
      cycleSubmittingRef.current = false;
    }
  }

  function confirmDisconnect() {
    Alert.alert(
      '파트너 연결을 해제할까요?',
      '서버 접근은 즉시 차단되고, 상대 기기의 공유 캐시는 다음 온라인 동기화에서 삭제됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '연결 해제',
          style: 'destructive',
          onPress: () => disconnectPair().catch(() => undefined),
        },
      ],
    );
  }

  function confirmReset() {
    Alert.alert(
      '개발 데이터를 초기화할까요?',
      '이 기기의 온보딩과 로컬 미리보기 기록이 삭제됩니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '초기화', style: 'destructive', onPress: resetApp },
      ],
    );
  }

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.title}>설정</Text>
      <Card style={styles.profileCard}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>나</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>내 사이클 페어</Text>
          <Text style={styles.profileBody}>
            {state.paired ? `${state.partnerName} 님과 연결됨` : '혼자 기록 중'}{' '}
            ·{' '}
            {backendKind === 'firebase' ? 'Firebase 동기화' : '테스트 미리보기'}
          </Text>
        </View>
        {showSubscription ? (
          <Chip
            label={
              subscriptionState.entitlement.tier === 'premium'
                ? 'Plus'
                : 'Free'
            }
          />
        ) : null}
      </Card>

      <SectionHeader title="계정과 복구" />
      <AccountSettingsCard />

      <SectionHeader
        title="내 주기 기록"
        action={
          <TextButton
            label={cycleEditing ? '취소' : '수정'}
            disabled={backendBusy}
            onPress={() => {
              if (cycleEditing) {
                setCycleRecords(state.isLogger);
                setHasCycleSeed(state.hasCycleSeed);
                setCycleSeed(state.seed);
              }
              setCycleEditing(value => !value);
            }}
          />
        }
      />
      {cycleEditing ? (
        <Card style={styles.cycleCard}>
          <ToggleRow
            title="주기 관련 기록 사용"
            description="끄면 기존 원본은 삭제하지 않지만 새 생리 시작·종료 기록을 멈춰요."
            value={cycleRecords}
            disabled={backendBusy}
            onValueChange={setCycleRecords}
          />
          {cycleRecords ? (
            <>
              <ToggleRow
                title="예측 기준 사용"
                description="날짜와 평균을 직접 입력한 경우에만 참고용 예측을 만들어요."
                value={hasCycleSeed}
                disabled={backendBusy}
                onValueChange={setHasCycleSeed}
              />
              {hasCycleSeed ? (
                <>
                  <Text style={styles.fieldLabel}>최근 생리 시작일</Text>
                  <TextInput
                    accessibilityLabel="최근 생리 시작일"
                    autoCapitalize="none"
                    editable={!backendBusy}
                    maxLength={10}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textSubtle}
                    style={[
                      styles.dateInput,
                      !cycleDateValid && styles.inputInvalid,
                    ]}
                    value={cycleSeed.lastPeriodStart}
                    onChangeText={lastPeriodStart =>
                      setCycleSeed(current => ({
                        ...current,
                        lastPeriodStart,
                        lastPeriodEnd: undefined,
                      }))
                    }
                  />
                  {!cycleDateValid ? (
                    <Text style={styles.inputError}>
                      오늘까지의 실제 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.
                    </Text>
                  ) : null}
                  <Stepper
                    label="평균 주기"
                    value={cycleSeed.averageCycleLength}
                    suffix="일"
                    min={21}
                    max={45}
                    disabled={backendBusy}
                    onChange={averageCycleLength =>
                      setCycleSeed(current => ({
                        ...current,
                        averageCycleLength,
                      }))
                    }
                  />
                  <Stepper
                    label="평균 기간"
                    value={cycleSeed.averagePeriodLength}
                    suffix="일"
                    min={2}
                    max={10}
                    disabled={backendBusy}
                    onChange={averagePeriodLength =>
                      setCycleSeed(current => ({
                        ...current,
                        averagePeriodLength,
                      }))
                    }
                  />
                </>
              ) : (
                <Text style={styles.cycleSummaryBody}>
                  예측 없이 실제 기록과 오늘의 컨디션만 관리합니다.
                </Text>
              )}
            </>
          ) : null}
          <View style={styles.cycleActions}>
            <SecondaryButton
              label="취소"
              disabled={backendBusy}
              onPress={() => {
                setCycleRecords(state.isLogger);
                setHasCycleSeed(state.hasCycleSeed);
                setCycleSeed(state.seed);
                setCycleEditing(false);
              }}
            />
            <PrimaryButton
              label={backendBusy ? '저장 중…' : '주기 기준 저장'}
              disabled={backendBusy || !cycleDateValid}
              onPress={() => {
                saveCycleSetup().catch(() => undefined);
              }}
            />
          </View>
        </Card>
      ) : (
        <Card style={styles.cycleSummaryCard}>
          <Text style={styles.cycleSummaryTitle}>
            {state.isLogger
              ? state.hasCycleSeed
                ? '주기 기록과 참고용 예측 사용 중'
                : '주기 기록 중 · 예측 기준 없음'
              : '주기 기록 사용 안 함'}
          </Text>
          <Text style={styles.cycleSummaryBody}>
            {state.isLogger
              ? state.hasCycleSeed
                ? `최근 시작일 ${state.seed.lastPeriodStart} · 평균 ${state.seed.averageCycleLength}일 · 기간 ${state.seed.averagePeriodLength}일`
                : '실제 시작·종료와 컨디션은 기록하지만 임의 기준으로 예측하지 않아요.'
              : '기분·증상·컨디션 기록은 주기 예측 없이 계속 사용할 수 있어요.'}
          </Text>
        </Card>
      )}

      <SectionHeader
        title="공유 범위"
        action={
          state.paired && state.sharingCompleted ? (
            <Text style={styles.count}>{selectedCount}개 공유 중</Text>
          ) : undefined
        }
      />
      {state.paired && state.sharingCompleted ? (
        <Card style={styles.rowsCard}>
          {shareRows.map(row => (
            <ToggleRow
              key={row.key}
              title={row.label}
              value={state.shareSettings[row.key]}
              disabled={backendBusy}
              onValueChange={() => toggleShare(row.key)}
            />
          ))}
        </Card>
      ) : state.paired ? (
        <Card tone="primary" style={styles.soloShareCard}>
          <Text style={styles.soloShareTitle}>공유 설정을 완료해 주세요</Text>
          <Text style={styles.soloShareBody}>
            Pair는 연결됐지만 아직 공유 중인 건강 정보는 없습니다.
          </Text>
          <PrimaryButton
            label="공유 설정 계속하기"
            disabled={backendBusy}
            onPress={continueToSharing}
          />
        </Card>
      ) : (
        <Card tone="primary" style={styles.soloShareCard}>
          <Text style={styles.soloShareTitle}>
            현재 공유 중인 정보가 없어요
          </Text>
          <Text style={styles.soloShareBody}>
            파트너를 연결한 뒤에도 직접 켠 항목만 별도 projection으로
            공유됩니다.
          </Text>
        </Card>
      )}

      <SectionHeader title="알림과 개인정보" />
      <Card style={styles.rowsCard}>
        <ToggleRow
          title="중립적인 잠금화면 알림"
          description={
            notificationBusy
              ? '기기 권한과 안전한 알림 등록을 확인하고 있어요.'
              : '건강정보·이름·날짜 없이 중립 문구로만 표시'
          }
          value={state.neutralNotifications}
          disabled={notificationBusy}
          onValueChange={() => {
            if (!notificationBusy) toggleNotifications().catch(() => undefined);
          }}
        />
        {state.neutralNotifications ? (
          <View style={styles.quietHours}>
            <View style={styles.quietHeader}>
              <View style={styles.linkCopy}>
                <Text style={styles.linkTitle}>조용한 시간</Text>
                <Text style={styles.linkDescription}>
                  기기 시간대 기준 · 이 시간에는 발송하지 않아요
                </Text>
              </View>
              <TextButton
                disabled={notificationBusy}
                label="저장"
                onPress={() => {
                  updateNotificationQuietHours(quietStart, quietEnd).catch(
                    () => undefined,
                  );
                }}
              />
            </View>
            <View style={styles.timeInputs}>
              <TextInput
                accessibilityLabel="조용한 시간 시작"
                autoCapitalize="none"
                editable={!notificationBusy}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                onChangeText={setQuietStart}
                placeholder="22:00"
                placeholderTextColor={colors.textSubtle}
                style={styles.timeInput}
                value={quietStart}
              />
              <Text style={styles.timeSeparator}>–</Text>
              <TextInput
                accessibilityLabel="조용한 시간 종료"
                autoCapitalize="none"
                editable={!notificationBusy}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                onChangeText={setQuietEnd}
                placeholder="08:00"
                placeholderTextColor={colors.textSubtle}
                style={styles.timeInput}
                value={quietEnd}
              />
            </View>
          </View>
        ) : null}
        <ToggleRow
          title="익명 진단 데이터"
          description={
            diagnosticsBusy
              ? '진단 수집 설정을 적용하고 있어요.'
              : '민감정보 없이 허용된 이벤트와 고정 오류 코드만 전송'
          }
          value={state.diagnosticsEnabled}
          disabled={diagnosticsBusy}
          onValueChange={() => {
            if (!diagnosticsBusy) toggleDiagnostics().catch(() => undefined);
          }}
        />
        <SettingLink
          title="개인정보와 데이터 관리 안내"
          description="수집·공유·알림·진단·내보내기·삭제 동작 확인"
          onPress={() => setPrivacyVisible(true)}
        />
      </Card>

      {showSubscription ? (
        <>
          <SectionHeader title="구독" />
          <SubscriptionSettingsCard />
        </>
      ) : null}

      <SectionHeader title="연결과 데이터" />
      <Card style={styles.rowsCard}>
        {state.paired ? (
          <SettingLink
            title={backendBusy ? '연결 해제 처리 중…' : '파트너 연결 해제'}
            description="접근권 즉시 회수 · 캐시 tombstone 동기화"
            onPress={confirmDisconnect}
            disabled={backendBusy}
            danger
          />
        ) : (
          <SettingLink
            title="파트너 연결하기"
            description="필요할 때 한 사람만 선택적으로 연결"
            onPress={openPairing}
            disabled={backendBusy}
          />
        )}
        {backendKind === 'preview' ? (
          <SettingLink
            title="개발 데이터 초기화"
            onPress={confirmReset}
            danger
          />
        ) : null}
      </Card>

      {backendError ? (
        <Text style={styles.syncError}>{backendError}</Text>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.brand}>∞ 사이클 페어</Text>
        <Text style={styles.version}>1.0.1 · 의료 도구 아님</Text>
      </View>
      <PrivacyCenterModal
        visible={privacyVisible}
        onClose={() => setPrivacyVisible(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '900',
    marginBottom: spacing.xl,
  },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  profileCopy: { flex: 1, gap: 2 },
  profileTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  profileBody: { color: colors.textMuted, fontSize: 11 },
  cycleCard: { gap: spacing.md, paddingTop: 0 },
  cycleSummaryCard: { gap: spacing.xs },
  cycleSummaryTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  cycleSummaryBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  dateInput: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
  },
  inputInvalid: { borderColor: colors.danger },
  inputError: { color: colors.danger, fontSize: 11, lineHeight: 17 },
  cycleActions: { gap: spacing.sm, marginTop: spacing.md },
  count: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  soloShareCard: { gap: spacing.xs },
  soloShareTitle: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: '900',
  },
  soloShareBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  rowsCard: { paddingVertical: 0 },
  quietHours: {
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  quietHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  timeInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timeInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 15,
    textAlign: 'center',
  },
  timeSeparator: { color: colors.textMuted, fontSize: 16 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  disabled: { opacity: 0.45 },
  linkCopy: { flex: 1, gap: spacing.xs },
  linkTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  linkDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  chevron: { color: colors.textSubtle, fontSize: 25 },
  danger: { color: colors.danger },
  syncError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.md,
  },
  footer: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.xxl },
  brand: { color: colors.primaryDark, fontSize: 14, fontWeight: '900' },
  version: { color: colors.textSubtle, fontSize: 10 },
});
