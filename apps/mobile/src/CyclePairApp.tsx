import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useCyclePair } from './app/CyclePairStore';
import { useHardwareBack } from './app/useHardwareBack';
import { BottomTabs } from './components/Ui';
import { CalendarScreen } from './screens/CalendarScreen';
import { HomeScreen } from './screens/HomeScreen';
import { InviteScreen } from './screens/InviteScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { PartnerScreen } from './screens/PartnerScreen';
import { RecordScreen } from './screens/RecordScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { SharingScreen } from './screens/SharingScreen';
import { colors, spacing } from './theme';

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <Text style={styles.loadingMark}>∞</Text>
      <Text style={styles.loadingTitle}>사이클 페어</Text>
      <ActivityIndicator color={colors.primary} style={styles.spinner} />
    </View>
  );
}

export function CyclePairApp() {
  const { state, isHydrating, goBack, setTab } = useCyclePair();
  const [recordOpen, setRecordOpen] = useState(false);
  const handleHardwareBack = useCallback(() => {
    if (recordOpen) {
      setRecordOpen(false);
      return true;
    }
    return goBack();
  }, [goBack, recordOpen]);

  useHardwareBack(handleHardwareBack);

  if (isHydrating) return <LoadingScreen />;
  if (state.stage === 'onboarding') return <OnboardingScreen />;
  if (state.stage === 'setup') return <SetupScreen />;
  if (state.stage === 'invite') return <InviteScreen />;
  if (state.stage === 'sharing') return <SharingScreen />;

  if (recordOpen) {
    return <RecordScreen onDone={() => setRecordOpen(false)} onCancel={() => setRecordOpen(false)} />;
  }

  return (
    <View style={styles.main}>
      <View style={styles.screen}>
        {state.activeTab === 'home' ? <HomeScreen onOpenRecord={() => setRecordOpen(true)} /> : null}
        {state.activeTab === 'calendar' ? <CalendarScreen /> : null}
        {state.activeTab === 'partner' ? <PartnerScreen /> : null}
        {state.activeTab === 'settings' ? <SettingsScreen /> : null}
      </View>
      <BottomTabs value={state.activeTab} onChange={setTab} />
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
