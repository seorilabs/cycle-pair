import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CyclePairProvider } from './src/app/CyclePairStore';
import { AccountProvider, useAccount } from './src/app/account/AccountContext';
import { SubscriptionProvider } from './src/app/subscription/SubscriptionContext';
import { CyclePairApp } from './src/CyclePairApp';
import type { AccountPort } from './src/domain/account/AccountPort';
import { previewAccountAdapter } from './src/platform/account/PreviewAccountAdapter';
import { createAccountSessionCleanup } from './src/platform/account/AccountSessionCleanup';
import type { CyclePairBackend } from './src/platform/backend/CyclePairBackend';
import { previewCyclePairBackend } from './src/platform/backend/PreviewCyclePairBackend';
import type { NotificationClient } from './src/platform/notifications/NotificationClient';
import { asyncStorageCyclePairStateStorage } from './src/platform/local/CyclePairStateStorage';
import type { ProductAnalytics } from './src/platform/observability/ProductAnalytics';
import type { SafeCrashReporter } from './src/platform/observability/SafeCrashReporter';
import type { CyclePairPurchaseAdapter } from './src/platform/purchases/CyclePairPurchaseAdapter';
import { AccountGateScreen } from './src/screens/AccountGateScreen';
import { colors } from './src/theme';

function AccountRuntime({
  backend,
  notificationClient,
  analytics,
  crashReporter,
  purchaseClient,
}: {
  backend: CyclePairBackend;
  notificationClient?: NotificationClient;
  analytics?: ProductAnalytics;
  crashReporter?: SafeCrashReporter;
  purchaseClient?: CyclePairPurchaseAdapter;
}) {
  const { state, deleteAccount } = useAccount();
  if (state.hydrating) {
    return (
      <View accessibilityLabel="계정 확인 중" style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (
    state.sessionQuiesced &&
    state.deletionRecovery === 'deletion-preparing' &&
    (!state.session || !state.session.isAnonymous)
  ) {
    return <AccountGateScreen deletionRecovery />;
  }
  if (state.sessionQuiesced) {
    return (
      <View accessibilityLabel="계정 삭제 복구" style={styles.recovery}>
        <Text style={styles.recoveryTitle}>계정 동기화를 중지했습니다</Text>
        <Text style={styles.recoveryBody}>
          {state.deletionRecovery === 'local-cleanup-pending'
            ? '서버 삭제는 확인했지만 기기 데이터 정리가 남았습니다. 정리를 완료할 때까지 저장과 동기화를 차단합니다.'
            : state.deletionRecovery === 'intent-unreadable'
              ? '보안 저장소의 계정 삭제 상태를 확인할 수 없습니다. 상태를 다시 읽을 때까지 로그인과 동기화를 차단합니다.'
              : state.deletionRecovery === 'deletion-pending'
                ? '서버가 삭제를 완료했는지 복구 영수증으로 확인할 때까지 이 계정의 저장과 동기화를 차단합니다.'
              : '삭제 완료 여부를 확인하지 못했습니다. 데이터가 다시 생성되지 않도록 이 계정의 저장과 동기화를 차단했습니다.'}
        </Text>
        {state.error ? <Text style={styles.recoveryError}>{state.error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={state.busy}
          onPress={() => deleteAccount().catch(() => undefined)}
          style={styles.recoveryPrimary}>
          <Text style={styles.recoveryPrimaryText}>
            {state.busy
              ? '처리 중…'
              : state.deletionRecovery === 'intent-unreadable'
                ? '삭제 상태 다시 확인'
                : state.deletionRecovery === 'deletion-pending' && !state.session
                  ? '삭제 상태 다시 확인'
                : state.session
                ? '계정 삭제 다시 시도'
                : '기기 데이터 정리 다시 시도'}
          </Text>
        </Pressable>
      </View>
    );
  }
  if (!state.session) return <AccountGateScreen />;
  return (
    <SubscriptionProvider
      analytics={analytics}
      key={state.session.uid}
      memberId={state.session.uid}
      purchaseClient={purchaseClient}>
      <CyclePairProvider
        analytics={analytics}
        backend={backend}
        crashReporter={crashReporter}
        notificationClient={notificationClient}>
        <CyclePairApp />
      </CyclePairProvider>
    </SubscriptionProvider>
  );
}

function App({
  backend = previewCyclePairBackend,
  account = previewAccountAdapter,
  notificationClient,
  analytics,
  crashReporter,
  purchaseClient,
}: {
  backend?: CyclePairBackend;
  account?: AccountPort;
  notificationClient?: NotificationClient;
  analytics?: ProductAnalytics;
  crashReporter?: SafeCrashReporter;
  purchaseClient?: CyclePairPurchaseAdapter;
}) {
  const sessionCleanup = useMemo(
    () =>
      createAccountSessionCleanup({
        storage: asyncStorageCyclePairStateStorage,
        backend,
        ...(notificationClient ? { notificationClient } : {}),
        ...(analytics ? { analytics } : {}),
        ...(crashReporter ? { crashReporter } : {}),
      }),
    [analytics, backend, crashReporter, notificationClient],
  );
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <AccountProvider
        account={account}
        crashReporter={crashReporter}
        sessionCleanup={sessionCleanup}>
        <AccountRuntime
          analytics={analytics}
          backend={backend}
          crashReporter={crashReporter}
          notificationClient={notificationClient}
          purchaseClient={purchaseClient}
        />
      </AccountProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  recovery: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
    gap: 14,
  },
  recoveryTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  recoveryBody: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  recoveryError: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  recoveryPrimary: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 14,
    backgroundColor: colors.primary,
  },
  recoveryPrimaryText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  recoverySecondary: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recoverySecondaryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default App;
