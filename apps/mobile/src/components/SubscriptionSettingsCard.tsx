import type {
  SubscriptionProduct,
  SubscriptionSnapshot,
} from '@cyclepair/product-core';
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {useSubscription} from '../app/subscription/SubscriptionContext';
import {Card, PrimaryButton, TextButton} from './Ui';
import {colors, spacing} from '../theme';

function statusTitle(subscription: SubscriptionSnapshot): string {
  switch (subscription.status) {
    case 'active':
      return '사이클 페어 Plus 이용 중';
    case 'trialing':
      return '사이클 페어 Plus 체험 중';
    case 'grace-period':
      return '결제 확인 유예 기간';
    case 'pending':
      return '결제 승인 대기 중';
    case 'on-hold':
      return '결제 수단 확인 필요';
    case 'canceled':
      return '갱신 취소됨';
    case 'expired':
      return '구독 만료됨';
    case 'revoked':
    case 'refunded':
      return '구독 혜택 종료됨';
    case 'unknown':
      return '구독 상태 확인 필요';
    case 'none':
      return '현재 Free 플랜';
  }
}

function statusDescription(subscription: SubscriptionSnapshot): string {
  const paidThrough =
    subscription.gracePeriodExpiresAt ?? subscription.expiresAt;
  const date = paidThrough?.slice(0, 10);
  switch (subscription.status) {
    case 'active':
    case 'trialing':
      return date
        ? `${date}까지 서버에서 확인된 혜택을 사용할 수 있어요.`
        : '서버에서 확인된 구독 혜택을 사용 중입니다.';
    case 'grace-period':
      return date
        ? `${date}까지 혜택을 유지하며 스토어 결제를 다시 확인합니다.`
        : '스토어 결제를 다시 확인하는 동안 혜택을 유지합니다.';
    case 'canceled':
      return date
        ? `${date}까지 이용할 수 있으며 이후 자동 갱신되지 않습니다.`
        : '현재 결제 기간 뒤에는 자동 갱신되지 않습니다.';
    case 'pending':
      return '스토어에서 결제가 완료되면 서버 검증 후 자동 반영됩니다.';
    case 'on-hold':
      return '스토어에서 결제 수단을 확인한 뒤 구매 복원을 눌러 주세요.';
    case 'expired':
    case 'revoked':
    case 'refunded':
      return '스토어 구매 내역을 다시 확인하려면 구매 복원을 눌러 주세요.';
    case 'unknown':
      return '혜택은 잠금 상태입니다. 새로고침 또는 구매 복원으로 확인해 주세요.';
    case 'none':
      return '주기 기록·기본 예측·한 명과의 공유·데이터 내보내기는 무료입니다.';
  }
}

function planLabel(product: SubscriptionProduct): string {
  const period = product.billingPeriod === 'P1Y' ? '연간' : '월간';
  return `${period} · ${product.displayPrice}`;
}

export function SubscriptionSettingsCard() {
  const {
    state,
    refresh,
    loadProducts,
    purchase,
    restore,
    manage,
  } = useSubscription();

  return (
    <Card tone="primary" style={styles.card}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>
            {state.entitlement.tier === 'premium'
              ? '서버 검증 완료'
              : '구독 상태'}
          </Text>
          <Text style={styles.title}>
            {state.hydrating
              ? '구독 상태 확인 중…'
              : statusTitle(state.subscription)}
          </Text>
          <Text style={styles.body}>
            {statusDescription(state.subscription)}
          </Text>
        </View>
      </View>

      {state.salesEnabled ? (
        <View style={styles.products}>
          {state.products.length === 0 ? (
            <PrimaryButton
              disabled={state.busy}
              label={state.busy ? '스토어 확인 중…' : '구독 상품 보기'}
              onPress={() => loadProducts().catch(() => undefined)}
            />
          ) : (
            state.products.map(product => (
              <PrimaryButton
                key={`${product.provider}:${product.productId}:${product.basePlanId}`}
                disabled={state.busy}
                label={planLabel(product)}
                onPress={() => purchase(product).catch(() => undefined)}
              />
            ))
          )}
        </View>
      ) : (
        <Text style={styles.salesOff}>
          새 구독은 현재 제공하지 않아요. 기존 구독의 구매 복원과 관리는
          계속 사용할 수 있어요.
        </Text>
      )}

      <View style={styles.actions}>
        <TextButton
          disabled={state.busy}
          label="새로고침"
          onPress={() => refresh().catch(() => undefined)}
        />
        <TextButton
          disabled={state.busy}
          label="구매 복원"
          onPress={() => restore().catch(() => undefined)}
        />
        <TextButton
          disabled={state.busy}
          label="구독 관리"
          onPress={() => manage().catch(() => undefined)}
        />
      </View>

      {state.notice ? <Text style={styles.notice}>{state.notice}</Text> : null}
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {gap: spacing.md},
  header: {flexDirection: 'row', gap: spacing.md},
  copy: {flex: 1, gap: spacing.xs},
  eyebrow: {color: colors.primary, fontSize: 11, fontWeight: '900'},
  title: {color: colors.text, fontSize: 18, fontWeight: '900'},
  body: {color: colors.textMuted, fontSize: 12, lineHeight: 18},
  salesOff: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  products: {gap: spacing.sm},
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  notice: {color: colors.primaryDark, fontSize: 11, lineHeight: 16},
  error: {color: colors.danger, fontSize: 11, lineHeight: 16},
});
