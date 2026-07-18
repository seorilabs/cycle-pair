import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCyclePair } from '../app/CyclePairStore';
import { colors, spacing } from '../theme';
import { Card, PrimaryButton } from './Ui';

function PolicySection({ title, body }: { title: string; body: string }) {
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </Card>
  );
}

export function PrivacyCenterModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose(): void;
}) {
  const { state } = useCyclePair();
  const consentDate = state.sensitiveDataConsentAcceptedAt
    ? new Date(state.sensitiveDataConsentAcceptedAt).toLocaleDateString('ko-KR')
    : '아직 동의하지 않음';

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.eyebrow}>Cycle Pair 데이터 안내</Text>
          <Text style={styles.title}>내 기록과 공유를 직접 통제해요</Text>
          <Text style={styles.meta}>제품 내 안내 버전 2026-07-14 · 민감정보 동의일 {consentDate}</Text>

          <PolicySection
            title="무엇을 저장하나요?"
            body="계정, 주기 시작·종료, 기분, 증상, 에너지, 컨디션, 원하는 도움과 직접 작성한 메모를 기능 제공에 필요한 범위로 저장합니다. 위치와 광고 식별자는 수집하지 않습니다."
          />
          <PolicySection
            title="누가 볼 수 있나요?"
            body="원본 기록은 본인 전용입니다. 파트너에게는 현재 Pair에서 직접 켠 필드만 별도 공유본으로 전달하며, 공유를 끄거나 Pair를 해제하면 서버 접근을 즉시 차단합니다."
          />
          <PolicySection
            title="기기와 알림"
            body="오프라인 변경은 기기 보안 저장소로 암호화합니다. 알림은 명시적으로 켠 경우에만 등록하며 잠금화면 문구와 payload에 건강정보, 이름, 날짜, 메모를 넣지 않습니다."
          />
          <PolicySection
            title="진단 데이터"
            body="Analytics와 Crashlytics는 별도 동의 시에만 켜집니다. 허용된 동작 이름과 고정 오류 코드만 보내며 UID, Pair ID, 날짜, 건강 값과 자유 텍스트는 보내지 않습니다."
          />
          <PolicySection
            title="내 권리"
            body="설정의 계정 카드에서 최근 비밀번호 확인 후 내 데이터를 JSON으로 내보내거나 계정과 서버 데이터를 영구 삭제할 수 있습니다. 구독 여부와 관계없이 사용할 수 있습니다."
          />
          <Text style={styles.disclaimer}>
            이 화면은 현재 구현의 데이터 동작을 설명합니다. 출시 전 법률 검토를 거친 외부 개인정보 처리방침과 마켓 고지는 별도로 확정됩니다.
          </Text>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="확인" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.md, padding: spacing.xl, paddingBottom: spacing.xxl },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  title: { color: colors.text, fontSize: 27, lineHeight: 35, fontWeight: '900' },
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
