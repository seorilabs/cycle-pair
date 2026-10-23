import { useI18n } from '../i18n/I18nProvider';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCyclePair } from '../app/CyclePairStore';
import { colors, spacing } from '../theme';
import { Card, PrimaryButton } from './Ui';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../domain/privacy/SensitiveHealthConsent';

function PolicySection({ title, body }: { title: string; body: string }) {
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </Card>
  );
}

export function PrivacyCenter({ onClose }: { onClose(): void }) {
  const { l, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const { state } = useCyclePair();
  const consentDate = state.sensitiveDataConsentAcceptedAt
    ? new Date(state.sensitiveDataConsentAcceptedAt).toLocaleDateString(locale)
    : l('아직 동의하지 않음');

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
      testID="privacy-center"
    >
      <ScrollView
        testID="privacy-scroll"
        contentContainerStyle={styles.content}
      >
        <Text style={styles.eyebrow}>{l('사이클 페어 데이터 안내')}</Text>
        <Text style={styles.title}>{l('내 기록과 공유를 직접 통제해요')}</Text>
        <Text style={styles.meta}>
          {l('민감정보 동의 ')}
          {SENSITIVE_HEALTH_CONSENT_VERSION}
          {l(' · 동의일 ')}
          {consentDate}
        </Text>

        <PolicySection
          title={l('무엇을 저장하나요?')}
          body={l(
            '계정, 주기 시작·종료, 기분, 증상, 에너지, 컨디션, 원하는 도움과 직접 작성한 메모를 기능 제공에 필요한 범위로 저장합니다. 위치와 광고 식별자는 수집하지 않습니다.',
          )}
        />
        <PolicySection
          title={l('누가 볼 수 있나요?')}
          body={l(
            '내 기록은 나만 볼 수 있어요. 선택한 항목만 상대에게 보이며, 공유를 끄거나 연결을 해제하면 상대의 접근을 차단해요.',
          )}
        />
        <PolicySection
          title={l('기기와 알림')}
          body={l(
            '오프라인 기록은 기기에 암호화해 보관해요. 알림은 직접 켠 경우에만 받으며 건강 정보, 이름, 날짜와 메모는 알림에 넣지 않아요.',
          )}
        />
        <PolicySection
          title={l('진단 데이터')}
          body={l(
            '사용 및 오류 정보는 따로 동의한 경우에만 수집해요. 계정과 연결 식별자, 날짜, 건강 정보, 직접 쓴 글은 보내지 않아요.',
          )}
        />
        <PolicySection
          title={l('내 권리')}
          body={l(
            '계정 설정에서 내 데이터를 내보내거나 계정을 삭제할 수 있어요. 계속하려면 비밀번호를 다시 확인해 주세요.',
          )}
        />
        <Text style={styles.disclaimer}>
          {l('개인정보 처리방침과 계정 삭제 안내는 설정에서 확인할 수 있어요.')}
        </Text>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton
          testID="privacy-close"
          label={l('확인')}
          onPress={onClose}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.md, padding: spacing.xl, paddingBottom: spacing.xxl },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  title: {
    color: colors.text,
    fontSize: 27,
    lineHeight: 35,
    fontWeight: '900',
  },
  meta: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  body: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  disclaimer: { color: colors.textSubtle, fontSize: 11, lineHeight: 17 },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
