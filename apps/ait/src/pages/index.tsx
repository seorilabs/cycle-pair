import { createRoute } from '@granite-js/react-native';
import {
  Button,
  Loader,
  SegmentedControl,
  Txt,
  colors,
} from '@toss/tds-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
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

// TDS has no generic safe-area, scroll, or layout primitives, so RN containers remain structural only.

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
  const handleChange = (nextValue: string) => {
    const nextOption = options.find(option => option.value === nextValue);
    if (nextOption) onChange(nextOption.value);
  };

  return (
    <View style={styles.section}>
      <Txt fontWeight="bold" typography="t4">
        {title}
      </Txt>
      <SegmentedControl.Root
        name={title}
        onChange={handleChange}
        value={value ?? ''}>
        {options.map(option => {
          return (
            <SegmentedControl.Item key={option.value} value={option.value}>
              {option.label}
            </SegmentedControl.Item>
          );
        })}
      </SegmentedControl.Root>
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
      <SafeAreaView style={styles.safeArea}>
        <Loader.FullScreen label="내 선택을 불러오고 있어요" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Txt color={colors.purple600} fontWeight="bold" typography="t6">
            사이클 페어
          </Txt>
          <Txt fontWeight="bold" typography="t1">
            오늘의 컨디션을{`\n`}내가 고른 만큼만
          </Txt>
          <Txt color={colors.grey700} typography="t5">
            주기나 날짜는 담지 않아요. 지금 상태와 원하는 배려를 직접 골라 공유해요.
          </Txt>
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
            <Txt color={colors.purple600} fontWeight="bold" typography="t6">
              공유할 내용
            </Txt>
            <Txt color={colors.grey800} typography="t5">
              {preview}
            </Txt>
          </View>
        ) : (
          <Txt color={colors.grey600} textAlign="center" typography="t6">
            두 항목을 모두 고르면 공유 내용을 미리 볼 수 있어요.
          </Txt>
        )}

        <View style={styles.actions}>
          <Button
            disabled={!ready || sharing}
            display="full"
            loading={sharing}
            onPress={handleShare}
            size="big">
            컨디션 공유하기
          </Button>
          <Button
            display="full"
            onPress={handleClear}
            size="medium"
            style="weak"
            type="dark">
            이 기기의 선택 내용 지우기
          </Button>
        </View>

        {status ? (
          <Txt color={colors.purple700} textAlign="center" typography="t6">
            {status}
          </Txt>
        ) : null}
        <Txt color={colors.grey500} textAlign="center" typography="t7">
          선택 내용은 AppsInToss Storage에만 보관되고, 공유 버튼을 누를 때만 공유 화면으로 전달돼요.
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 36, gap: 20 },
  hero: {
    borderRadius: 24,
    padding: 22,
    backgroundColor: colors.purple50,
    gap: 8,
  },
  section: { gap: 12 },
  preview: {
    borderRadius: 18,
    backgroundColor: colors.layeredBackground,
    padding: 18,
    gap: 8,
  },
  actions: { gap: 8 },
});
