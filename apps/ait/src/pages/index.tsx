import { createRoute } from '@granite-js/react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { aitAnalytics, type AitAnalytics } from '../analytics';
import {
  clearConditionShareDraft,
  getLocalDateKey,
  readConditionShareDraft,
  writeConditionShareDraft,
} from '../condition-storage';
import { openShareSheet } from '../open-share-sheet';
import {
  CONDITION_OPTIONS,
  EMPTY_SHARE_DRAFT,
  HELP_OPTIONS,
  buildConditionShareMessage,
  isCompleteShareDraft,
  type ConditionShareDraft,
} from '../share-draft';

export const Route = createRoute('/', { component: ConditionSharePage });

function ChoiceGroup<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  readonly title: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T | null;
  readonly onChange: (next: T) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.choiceGrid}>
        {options.map(option => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.choice, selected && styles.choiceSelected]}>
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ConditionSharePage({
  analytics = aitAnalytics,
}: {
  readonly analytics?: AitAnalytics;
} = {}) {
  const [draft, setDraft] = useState<ConditionShareDraft>(EMPTY_SHARE_DRAFT);
  const [hydrating, setHydrating] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const draftLocalDate = useRef(getLocalDateKey());

  const ensureCurrentDate = useCallback(
    async (currentLocalDate = getLocalDateKey()): Promise<boolean> => {
      if (draftLocalDate.current === currentLocalDate) return true;

      draftLocalDate.current = currentLocalDate;
      setDraft(EMPTY_SHARE_DRAFT);
      setStatus('날짜가 바뀌어 이전 선택을 비웠어요.');
      await clearConditionShareDraft().catch(() => {
        setStatus('날짜가 바뀌어 선택을 비웠지만 저장 내용을 지우지 못했어요.');
      });
      return false;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const requestedLocalDate = draftLocalDate.current;
    readConditionShareDraft(requestedLocalDate)
      .then(value => {
        if (!active) return;
        if (getLocalDateKey() !== requestedLocalDate) {
          void ensureCurrentDate();
          return;
        }
        setDraft(value);
        if (value.condition !== null || value.helpPreference !== null) {
          analytics.track({ name: 'cp_ait_draft_restored' });
        }
      })
      .finally(() => {
        if (active) setHydrating(false);
      });
    return () => {
      active = false;
    };
  }, [analytics, ensureCurrentDate]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') void ensureCurrentDate();
    });
    return () => subscription.remove();
  }, [ensureCurrentDate]);

  const ready = isCompleteShareDraft(draft);
  const preview = useMemo(
    () => (ready ? buildConditionShareMessage(draft) : null),
    [draft, ready],
  );

  const updateDraft = (next: ConditionShareDraft) => {
    const currentLocalDate = getLocalDateKey();
    if (draftLocalDate.current !== currentLocalDate) {
      void ensureCurrentDate(currentLocalDate);
      return;
    }
    setDraft(next);
    setStatus(null);
    writeConditionShareDraft(next, currentLocalDate).catch(() => {
      setStatus('이 기기에 선택 내용을 저장하지 못했어요.');
    });
  };

  const handleShare = async () => {
    if (sharing || !(await ensureCurrentDate()) || !preview) return;
    setSharing(true);
    analytics.track({ name: 'cp_ait_share_open' });
    const outcome = await openShareSheet(preview);
    analytics.track({ name: 'cp_ait_share_result', params: { outcome } });
    setSharing(false);
    setStatus(
      outcome === 'opened'
        ? '공유 화면을 열었어요. 보낼 상대와 내용을 확인해 주세요.'
        : outcome === 'unsupported'
          ? '현재 토스 앱에서는 공유 기능을 사용할 수 없어요.'
          : '공유 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.',
    );
  };

  const handleClear = async () => {
    analytics.track({ name: 'cp_ait_draft_cleared' });
    draftLocalDate.current = getLocalDateKey();
    setDraft(EMPTY_SHARE_DRAFT);
    setStatus('이 기기에 저장된 선택 내용을 지웠어요.');
    await clearConditionShareDraft().catch(() => {
      setStatus('선택 내용을 지우지 못했어요. 잠시 후 다시 시도해 주세요.');
    });
  };

  if (hydrating) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color="#76558F" size="large" />
        <Text style={styles.loadingText}>내 선택을 불러오고 있어요</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>사이클 페어</Text>
          <Text style={styles.title}>오늘의 컨디션을{`\n`}내가 고른 만큼만</Text>
          <Text style={styles.description}>
            주기나 날짜는 담지 않아요. 지금 상태와 원하는 배려를 직접 골라 공유해요.
          </Text>
        </View>

        <ChoiceGroup
          onChange={condition => {
            analytics.track({
              name: 'cp_ait_condition_select',
              params: { group: 'condition', value: condition },
            });
            updateDraft({ ...draft, condition });
          }}
          options={CONDITION_OPTIONS}
          title="오늘 컨디션은 어때요?"
          value={draft.condition}
        />
        <ChoiceGroup
          onChange={helpPreference => {
            analytics.track({
              name: 'cp_ait_condition_select',
              params: { group: 'help', value: helpPreference },
            });
            updateDraft({ ...draft, helpPreference });
          }}
          options={HELP_OPTIONS}
          title="어떻게 함께해 주면 좋을까요?"
          value={draft.helpPreference}
        />

        {preview ? (
          <View style={styles.preview}>
            <Text style={styles.previewLabel}>공유할 내용</Text>
            <Text style={styles.previewText}>{preview}</Text>
          </View>
        ) : (
          <Text style={styles.helper}>두 항목을 모두 고르면 공유 내용을 미리 볼 수 있어요.</Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={!ready || sharing}
          onPress={handleShare}
          style={[styles.primaryButton, (!ready || sharing) && styles.buttonDisabled]}>
          <Text style={styles.primaryButtonText}>
            {sharing ? '공유 화면 여는 중…' : '컨디션 공유하기'}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={handleClear} style={styles.clearButton}>
          <Text style={styles.clearButtonText}>이 기기의 선택 내용 지우기</Text>
        </Pressable>

        {status ? <Text style={styles.status}>{status}</Text> : null}
        <Text style={styles.privacyNote}>
          선택 내용은 AppsInToss Storage에만 보관되고, 공유 버튼을 누를 때만 공유 화면으로 전달돼요.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FBF8FC' },
  content: { padding: 20, paddingBottom: 36, gap: 20 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#FBF8FC',
  },
  loadingText: { color: '#6D6677', fontSize: 15 },
  hero: {
    borderRadius: 24,
    padding: 22,
    backgroundColor: '#F0E6F3',
    gap: 8,
  },
  eyebrow: { color: '#76558F', fontSize: 14, fontWeight: '800' },
  title: {
    color: '#2D2837',
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 38,
  },
  description: { color: '#625A6C', fontSize: 15, lineHeight: 22 },
  section: { gap: 12 },
  sectionTitle: { color: '#2D2837', fontSize: 18, fontWeight: '800' },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    minWidth: '47%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DED5E3',
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  choiceSelected: { borderColor: '#76558F', backgroundColor: '#F0E6F3' },
  choiceText: { color: '#514A5A', textAlign: 'center', fontSize: 15, fontWeight: '600' },
  choiceTextSelected: { color: '#5D3E75', fontWeight: '800' },
  preview: { borderRadius: 18, backgroundColor: '#FFFFFF', padding: 18, gap: 8 },
  previewLabel: { color: '#76558F', fontSize: 13, fontWeight: '800' },
  previewText: { color: '#3D3745', fontSize: 15, lineHeight: 23 },
  helper: { color: '#746D7C', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 16,
    backgroundColor: '#76558F',
  },
  buttonDisabled: { opacity: 0.42 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  clearButton: { alignItems: 'center', paddingVertical: 10 },
  clearButtonText: { color: '#6D6677', fontSize: 14, fontWeight: '600' },
  status: { color: '#5D3E75', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  privacyNote: { color: '#817987', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
