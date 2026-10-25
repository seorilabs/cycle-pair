import { SEORILABS_PLATFORM_APP_VERSION } from '../platform/seorilabsPlatform';
import { formatDate, useI18n } from '../i18n/I18nProvider';
import { isLocalDate, parseLocalDate } from '@cyclepair/product-core';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CycleSeed, useCyclePair } from '../app/CyclePairStore';
import { AccountSettingsCard } from '../components/AccountSettingsCard';
import { PrivacyCenter } from '../components/PrivacyCenter';
import {
  Card,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Stepper,
  TextButton,
  ToggleRow,
} from '../components/Ui';
import { colors, spacing } from '../theme';

type SettingsSectionKey =
  | 'account'
  | 'cycle'
  | 'sharing'
  | 'notifications'
  | 'language'
  | 'connection'
  | 'about';

function SettingsAccordionSection({
  title,
  summary,
  expanded,
  onPress,
  children,
  detail,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  onPress(): void;
  children: React.ReactNode;
  detail?: { content: React.ReactNode; onClose(): void };
}) {
  const { l } = useI18n();
  return (
    <View style={styles.accordionSection}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onPress}
        style={styles.accordionHeader}
      >
        <View style={styles.accordionCopy}>
          <Text style={styles.accordionTitle}>{title}</Text>
          <Text numberOfLines={1} style={styles.accordionSummary}>
            {summary}
          </Text>
        </View>
        <Text style={styles.accordionChevron}>{expanded ? '⌃' : '⌄'}</Text>
      </Pressable>
      <Modal
        visible={expanded}
        animationType="slide"
        onRequestClose={detail?.onClose ?? onPress}
      >
        {detail ? (
          detail.content
        ) : (
          <Screen>
            <TextButton label={l('뒤로')} onPress={onPress} />
            <Text
              accessibilityRole="header"
              style={[styles.accordionTitle, { marginVertical: spacing.lg }]}
            >
              {title}
            </Text>
            {children}
          </Screen>
        )}
      </Modal>
    </View>
  );
}

function SettingLink({
  title,
  description,
  testID,
  onPress,
  danger = false,
  disabled = false,
}: {
  title: string;
  description?: string;
  testID?: string;
  onPress(): void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
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
  const { l, locale } = useI18n();
  const { t, choice, setLanguage } = useI18n();
  const {
    state,
    backendKind,
    backendSession,
    backendBusy,
    notificationBusy,
    diagnosticsBusy,
    backendError,
    openPairing,
    continueToSharing,
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
  const [languageError, setLanguageError] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [openSection, setOpenSection] = useState<SettingsSectionKey | null>(
    null,
  );
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

  function resetCycleDraft() {
    setCycleRecords(state.isLogger);
    setHasCycleSeed(state.hasCycleSeed);
    setCycleSeed(state.seed);
    setCycleEditing(false);
  }

  function resetQuietHoursDraft() {
    setQuietStart(state.notificationQuietHours.start);
    setQuietEnd(state.notificationQuietHours.end);
  }

  function toggleSection(nextSection: SettingsSectionKey) {
    if (openSection === 'cycle') resetCycleDraft();
    if (openSection === 'notifications') resetQuietHoursDraft();
    setPrivacyVisible(false);
    setOpenSection(current => (current === nextSection ? null : nextSection));
  }

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
      l('파트너 연결을 해제할까요?'),
      l(
        '서버 접근은 즉시 차단되고, 상대 기기의 공유 캐시는 다음 온라인 동기화에서 삭제됩니다.',
      ),
      [
        { text: l('취소'), style: 'cancel' },
        {
          text: l('연결 해제'),
          style: 'destructive',
          onPress: () => disconnectPair().catch(() => undefined),
        },
      ],
    );
  }

  function confirmReset() {
    Alert.alert(
      l('개발 데이터를 초기화할까요?'),
      l('이 기기의 온보딩과 로컬 미리보기 기록이 삭제됩니다.'),
      [
        { text: l('취소'), style: 'cancel' },
        { text: l('초기화'), style: 'destructive', onPress: resetApp },
      ],
    );
  }

  const privacyDetail = privacyVisible
    ? {
        content: <PrivacyCenter onClose={() => setPrivacyVisible(false)} />,
        onClose: () => setPrivacyVisible(false),
      }
    : undefined;

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.title}>{l('설정')}</Text>
      <Card style={styles.profileCard}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>{l('나')}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>{l('내 사이클 페어')}</Text>
          <Text style={styles.profileBody}>
            {state.paired
              ? l('{v0} 님과 연결됨', { v0: state.partnerName === '파트너' ? t('Partner') : state.partnerName })
              : l('혼자 기록 중')}{' '}
            · {backendKind === 'firebase' ? l('동기화') : l('테스트 미리보기')}
          </Text>
        </View>
      </Card>

      <View style={styles.accordionList}>
        <SettingsAccordionSection
          title={l('계정과 복구')}
          summary={
            backendSession ? l('로그인됨 · 복구와 내보내기') : l('로그인 필요')
          }
          expanded={openSection === 'account'}
          onPress={() => toggleSection('account')}
        >
          <AccountSettingsCard />
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={l('내 주기')}
          summary={
            state.isLogger
              ? state.hasCycleSeed
                ? l('주기 기록 · 다음 생리 예상 켜짐')
                : l('주기 기록 · 다음 생리 예상 꺼짐')
              : l('주기 기록 사용 안 함')
          }
          expanded={openSection === 'cycle'}
          onPress={() => toggleSection('cycle')}
        >
          <View style={styles.sectionActionHeader}>
            <Text style={styles.sectionBodyTitle}>{l('내 주기 기록')}</Text>
            <TextButton
              label={cycleEditing ? l('취소') : l('수정')}
              disabled={backendBusy}
              onPress={() => {
                if (cycleEditing) resetCycleDraft();
                else setCycleEditing(true);
              }}
            />
          </View>
          {cycleEditing ? (
            <Card style={styles.cycleCard}>
              <ToggleRow
                title={l('주기 관련 기록 사용')}
                description={l(
                  '끄면 기존 원본은 삭제하지 않지만 새 생리 시작·종료 기록을 멈춰요.',
                )}
                value={cycleRecords}
                disabled={backendBusy}
                onValueChange={setCycleRecords}
              />
              {cycleRecords ? (
                <>
                  <ToggleRow
                    title={l('다음 생리일 미리 보기')}
                    description={l(
                      '최근 생리일과 평소 주기를 바탕으로 다음 예상 범위를 보여드려요.',
                    )}
                    value={hasCycleSeed}
                    disabled={backendBusy}
                    onValueChange={setHasCycleSeed}
                  />
                  {hasCycleSeed ? (
                    <>
                      <Text style={styles.fieldLabel}>
                        {l('최근 생리 시작일')}
                      </Text>
                      <TextInput
                        accessibilityLabel={l('최근 생리 시작일')}
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
                          {l(
                            '오늘까지의 실제 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.',
                          )}
                        </Text>
                      ) : null}
                      <Stepper
                        label={l('다음 생리까지 보통')}
                        value={cycleSeed.averageCycleLength}
                        suffix={l('일')}
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
                        label={l('생리가 보통')}
                        value={cycleSeed.averagePeriodLength}
                        suffix={l('일')}
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
                      {l('예측 없이 실제 기록과 오늘의 컨디션만 관리합니다.')}
                    </Text>
                  )}
                </>
              ) : null}
              <View style={styles.cycleActions}>
                <SecondaryButton
                  label={l('취소')}
                  disabled={backendBusy}
                  onPress={resetCycleDraft}
                />
                <PrimaryButton
                  label={backendBusy ? l('저장 중…') : l('변경사항 저장')}
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
                    ? l('주기와 다음 생리 예상 사용 중')
                    : l('주기 기록 중 · 다음 생리 예상 꺼짐')
                  : l('주기 기록 사용 안 함')}
              </Text>
              <Text style={styles.cycleSummaryBody}>
                {state.isLogger
                  ? state.hasCycleSeed
                    ? l('최근 시작일 {v0} · 주기 {v1}일 · 기간 {v2}일', {
                        v0: formatDate(
                          parseLocalDate(state.seed.lastPeriodStart),
                          locale,
                        ),
                        v1: state.seed.averageCycleLength,
                        v2: state.seed.averagePeriodLength,
                      })
                    : l('실제 생리일과 컨디션만 기록해요.')
                  : l(
                      '기분·증상·컨디션 기록은 주기 예측 없이 계속 사용할 수 있어요.',
                    )}
              </Text>
            </Card>
          )}
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={l('공유 범위')}
          summary={
            state.paired && state.sharingCompleted
              ? l('{v0}개 공유 중', { v0: selectedCount })
              : state.paired
              ? l('공유 설정 필요')
              : l('공유 없음')
          }
          expanded={openSection === 'sharing'}
          onPress={() => toggleSection('sharing')}
        >
          <Card style={styles.soloShareCard}>
            <Text style={styles.soloShareBody}>
              {t('Nothing is shared until you choose.')}
            </Text>
            <PrimaryButton
              label={t(
                state.paired ? 'Choose what to share' : 'Connect a partner',
              )}
              disabled={backendBusy}
              onPress={state.paired ? continueToSharing : openPairing}
            />
          </Card>
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={l('알림과 개인정보')}
          summary={`${
            state.neutralNotifications ? l('알림 켜짐') : l('알림 꺼짐')
          } · ${state.diagnosticsEnabled ? l('진단 허용') : l('진단 안 함')}`}
          expanded={openSection === 'notifications'}
          onPress={() => toggleSection('notifications')}
          detail={privacyDetail}
        >
          <Card style={styles.rowsCard}>
            {backendError ? (
              <Text accessibilityRole="alert" testID="notification-feedback" style={styles.syncError}>{l(backendError)}</Text>
            ) : null}
            <ToggleRow
              title={l('중립적인 잠금화면 알림')}
              description={
                notificationBusy
                  ? l('기기 권한과 안전한 알림 등록을 확인하고 있어요.')
                  : l('건강정보·이름·날짜 없이 중립 문구로만 표시')
              }
              value={state.neutralNotifications}
              disabled={notificationBusy}
              onValueChange={() => {
                if (!notificationBusy)
                  toggleNotifications().catch(() => undefined);
              }}
            />
            {state.neutralNotifications ? (
              <View style={styles.quietHours}>
                <View style={styles.quietHeader}>
                  <View style={styles.linkCopy}>
                    <Text style={styles.linkTitle}>{l('조용한 시간')}</Text>
                    <Text style={styles.linkDescription}>
                      {l('기기 시간대 기준 · 이 시간에는 발송하지 않아요')}
                    </Text>
                  </View>
                  <TextButton
                    disabled={notificationBusy}
                    label={l('저장')}
                    onPress={() => {
                      updateNotificationQuietHours(quietStart, quietEnd).catch(
                        () => undefined,
                      );
                    }}
                  />
                </View>
                <View style={styles.timeInputs}>
                  <TextInput
                    accessibilityLabel={l('조용한 시간 시작')}
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
                    accessibilityLabel={l('조용한 시간 종료')}
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
              testID="diagnostics-toggle"
              title={l('사용 및 오류 진단')}
              description={
                diagnosticsBusy
                  ? l('진단 수집 설정을 적용하고 있어요.')
                  : l('설치 식별자와 대략적인 지역이 포함된 사용 및 오류 정보')
              }
              value={state.diagnosticsEnabled}
              disabled={diagnosticsBusy}
              onValueChange={() => {
                if (!diagnosticsBusy)
                  toggleDiagnostics().catch(() => undefined);
              }}
            />
            <SettingLink
              testID="privacy-open"
              title={l('개인정보와 데이터 관리 안내')}
              description={l('수집·공유·알림·진단·내보내기·삭제 동작 확인')}
              onPress={() => setPrivacyVisible(true)}
            />
          </Card>
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={t('Language')}
          summary={t(
            choice === 'system'
              ? 'System'
              : choice === 'ko'
              ? 'Korean'
              : 'English',
          )}
          expanded={openSection === 'language'}
          onPress={() => toggleSection('language')}
        >
          {languageError ? (
            <Text accessibilityRole="alert" style={styles.danger}>
              {t('Could not save your language. Try again.')}
            </Text>
          ) : null}
          <Card>
            {(['system', 'ko', 'en'] as const).map(value => (
              <SettingLink
                key={value}
                testID={`language-${value}`}
                title={`${choice === value ? '✓ ' : ''}${t(
                  value === 'system'
                    ? 'System'
                    : value === 'ko'
                    ? 'Korean'
                    : 'English',
                )}`}
                onPress={() => {
                  setLanguage(value)
                    .then(() => setLanguageError(false))
                    .catch(() => setLanguageError(true));
                }}
              />
            ))}
          </Card>
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={l('연결과 데이터')}
          summary={
            state.paired
              ? l('{v0} 님과 연결됨', { v0: state.partnerName === '파트너' ? t('Partner') : state.partnerName })
              : l('연결 안 됨')
          }
          expanded={openSection === 'connection'}
          onPress={() => toggleSection('connection')}
        >
          <Card style={styles.rowsCard}>
            {state.paired ? (
              <SettingLink
                title={
                  backendBusy ? l('연결 해제 처리 중…') : l('파트너 연결 해제')
                }
                description={l(
                  '공유 접근을 끄고 상대의 저장된 공유 정보도 정리해요.',
                )}
                onPress={confirmDisconnect}
                disabled={backendBusy}
                danger
              />
            ) : (
              <SettingLink
                title={l('파트너 연결하기')}
                description={l('필요할 때 한 사람만 선택적으로 연결')}
                onPress={openPairing}
                disabled={backendBusy}
              />
            )}
            {backendKind === 'preview' ? (
              <SettingLink
                title={l('개발 데이터 초기화')}
                onPress={confirmReset}
                danger
              />
            ) : null}
          </Card>
        </SettingsAccordionSection>

        <SettingsAccordionSection
          title={l('앱 안내')}
          summary={l('개인정보 · 비의료 고지')}
          expanded={openSection === 'about'}
          onPress={() => toggleSection('about')}
          detail={privacyDetail}
        >
          <Card style={styles.aboutCard}>
            <Text style={styles.aboutTitle}>{l('건강 정보 이용 안내')}</Text>
            <Text style={styles.aboutBody}>
              {l(
                '사이클 페어는 의료기기가 아닙니다. 제공되는 기록과 예상 정보는 질환을 진단·치료·치유·예방하기 위한 것이 아니며, 피임 또는 임신 가능성 판단에 사용할 수 없습니다. 건강에 관한 결정은 의료 전문가와 상의해 주세요.',
              )}
            </Text>
            <SettingLink
              title={l('개인정보 안내 보기')}
              description={l('수집·공유·보관·삭제 기준 확인')}
              onPress={() => setPrivacyVisible(true)}
            />
            <View style={styles.appIdentity}>
              <Text style={styles.brand}>{l('∞ 사이클 페어')}</Text>
              <Text style={styles.version}>
                {l('버전 {v0}', { v0: SEORILABS_PLATFORM_APP_VERSION })}
              </Text>
            </View>
          </Card>
        </SettingsAccordionSection>
      </View>

      {backendError && openSection !== 'notifications' ? (
        <Text style={styles.syncError}>{l(backendError)}</Text>
      ) : null}
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
  accordionList: { gap: spacing.sm, marginTop: spacing.lg },
  accordionSection: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  accordionHeader: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  accordionCopy: { flex: 1, gap: 3 },
  accordionTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  accordionSummary: { color: colors.textMuted, fontSize: 11 },
  accordionChevron: {
    width: 24,
    color: colors.primaryDark,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  accordionBody: {
    gap: spacing.md,
    padding: spacing.md,
    paddingTop: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sectionActionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  sectionBodyTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
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
    minWidth: 0,
    width: 0,
    minHeight: 48,
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
  aboutCard: { gap: spacing.md },
  aboutTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  aboutBody: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  appIdentity: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  syncError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.md,
  },
  brand: { color: colors.primaryDark, fontSize: 14, fontWeight: '900' },
  version: { color: colors.textSubtle, fontSize: 10 },
});
