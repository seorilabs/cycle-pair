import {useI18n} from './i18n/I18nProvider';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useCyclePair } from './app/CyclePairStore';
import { useHardwareBack } from './app/useHardwareBack';
import { useKeyboardVisibility } from './app/useKeyboardVisibility';
import { InAppMessageBox, InAppToast } from './components/InAppNotifications';
import { BottomTabs } from './components/Ui';
import { CalendarScreen } from './screens/CalendarScreen';
import { HomeScreen } from './screens/HomeScreen';
import { InviteScreen, type InviteDraft } from './screens/InviteScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { PartnerScreen } from './screens/PartnerScreen';
import { RecordScreen } from './screens/RecordScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import {
  createSetupDraft,
  SetupScreen,
  type SetupDraft,
} from './screens/SetupScreen';
import { SharingScreen } from './screens/SharingScreen';
import { colors, spacing } from './theme';

function LoadingScreen() {
  const {l} = useI18n();
  return (
    <View style={styles.loading}>
      <Text style={styles.loadingMark}>∞</Text>
      <Text style={styles.loadingTitle}>{l("사이클 페어")}</Text>
      <ActivityIndicator color={colors.primary} style={styles.spinner} />
    </View>
  );
}

export function CyclePairApp() {
  const {
    state,
    backendBusy,
    isHydrating,
    goBack,
    setTab,
    inAppNotices,
    toastNotice,
    dismissToastNotice,
    openInAppNotice,
  } = useCyclePair();
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordDraft, setRecordDraft] = useState<{date: string; value: import('./app/CyclePairStore').DailyCheckIn} | null>(null);
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);
  const [inviteDraft, setInviteDraft] = useState<InviteDraft>({
    direction: null,
    code: '',
  });
  const keyboardVisible = useKeyboardVisibility();
  const latestNotice = inAppNotices[0];
  useEffect(() => {
    if (state.stage !== 'setup' && state.stage !== 'onboarding') {
      setSetupDraft(null);
    }
    if (state.stage !== 'invite') {
      setInviteDraft({ direction: null, code: '' });
    }
  }, [state.stage]);
  const closeRecord = useCallback(() => {
    if (!backendBusy) setRecordOpen(false);
  }, [backendBusy]);
  const backFromInvite = useCallback(() => {
    if (backendBusy) return true;
    if (!state.paired && inviteDraft.direction !== null) {
      setInviteDraft(current => ({ ...current, direction: null }));
      return true;
    }
    return goBack();
  }, [backendBusy, goBack, inviteDraft.direction, state.paired]);
  const handleHardwareBack = useCallback(() => {
    if (recordOpen) {
      closeRecord();
      return true;
    }
    if (state.stage === 'invite') return backFromInvite();
    return goBack();
  }, [backFromInvite, closeRecord, goBack, recordOpen, state.stage]);

  useHardwareBack(handleHardwareBack);

  if (isHydrating) return <LoadingScreen />;
  if (state.stage === 'onboarding') return <OnboardingScreen />;
  if (state.stage === 'setup') {
    return (
      <SetupScreen
        draft={setupDraft ?? createSetupDraft(state)}
        onDraftChange={setSetupDraft}
      />
    );
  }
  if (state.stage === 'invite') {
    return (
      <InviteScreen
        draft={inviteDraft}
        onDraftChange={setInviteDraft}
        onBack={backFromInvite}
      />
    );
  }
  if (state.stage === 'sharing') return <SharingScreen />;

  if (recordOpen) {
    return <RecordScreen initialDraft={recordDraft?.date === state.currentLocalDate ? recordDraft.value : undefined} onDraftChange={value => setRecordDraft({date: state.currentLocalDate, value})} onDone={() => {setRecordOpen(false); setRecordDraft(null);}} onCancel={closeRecord} />;
  }

  return (
    <View style={styles.main}>
      <InAppToast
        notice={toastNotice}
        onDismiss={dismissToastNotice}
        onOpen={openInAppNotice}
      />
      <View style={styles.screen}>
        {state.activeTab === 'home' ? <HomeScreen onOpenRecord={() => setRecordOpen(true)} /> : null}
        {state.activeTab === 'calendar' ? <CalendarScreen /> : null}
        {state.activeTab === 'partner' ? <PartnerScreen /> : null}
        {state.activeTab === 'settings' ? <SettingsScreen /> : null}
      </View>
      {!keyboardVisible && latestNotice ? (
        <InAppMessageBox
          count={inAppNotices.length}
          notice={latestNotice}
          onOpen={openInAppNotice}
        />
      ) : null}
      {!keyboardVisible ? (
        <BottomTabs value={state.activeTab} onChange={setTab} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  main: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  loadingMark: { color: colors.primary, fontSize: 72, lineHeight: 82 },
  loadingTitle: { color: colors.text, fontSize: 26, fontWeight: '900' },
  spinner: { marginTop: spacing.xl },
});
