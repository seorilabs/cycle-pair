import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { addEventListener as addNetworkListener } from '@react-native-community/netinfo';
import { AppState, Platform } from 'react-native';
import {
  asyncStorageCyclePairStateStorage,
  type CyclePairStateStorage,
} from '../platform/local/CyclePairStateStorage';
import type {
  ActivePairMembership,
  BackendKind,
  BackendSession,
  BackendWriteResult,
  CyclePairBackend,
  PairEvent,
  PairEventInput,
  PairInvite,
  PartnerNudgeState,
  PartnerNudgeType,
  RemotePartnerProjection,
} from '../platform/backend/CyclePairBackend';
import {
  fromBackendShareSettings,
  fromPrivateDailyLogSnapshot,
  toDeviceLocalDate,
  toBackendShareSettings,
  toPrivateCycleRecord,
  toPrivateDailyLogRecord,
} from '../platform/backend/backendPayloads';
import { previewCyclePairBackend } from '../platform/backend/PreviewCyclePairBackend';
import type {
  NotificationClient,
  QuietHours,
} from '../platform/notifications/NotificationClient';
import type { ProductAnalytics } from '../platform/observability/ProductAnalytics';
import type {
  CrashSurface,
  SafeCrashReporter,
  SafeFailureCode,
} from '../platform/observability/SafeCrashReporter';
import {
  hasCurrentSensitiveHealthConsent,
  SENSITIVE_HEALTH_CONSENT_VERSION,
} from '../domain/privacy/SensitiveHealthConsent';
import {
  hasMeaningfulPartnerProjectionChange,
  hasPartnerPairEventUpdate,
  noticeCopy,
  type InAppNotice,
  type InAppNoticeKind,
} from './inAppNotifications';

export type AppStage = 'onboarding' | 'setup' | 'invite' | 'sharing' | 'main';
export type MainTab = 'home' | 'calendar' | 'partner' | 'settings';
export type ShareField =
  | 'cyclePhase'
  | 'cycleStatus'
  | 'fertilityStatus'
  | 'predictedPeriod'
  | 'periodDates'
  | 'mood'
  | 'symptoms'
  | 'energy'
  | 'condition'
  | 'carePreference'
  | 'note';

export interface CycleSeed {
  lastPeriodStart: string;
  lastPeriodEnd?: string;
  averageCycleLength: number;
  averagePeriodLength: number;
}

export interface DailyCheckIn {
  mood?: '힘들어요' | '지쳐요' | '괜찮아요' | '좋아요';
  symptoms: string[];
  energy?: 1 | 2 | 3 | 4 | 5;
  condition?: '편안해요' | '피곤해요' | '기운이 없어요' | '공간이 필요해요';
  carePreference?:
    | '쉬고 싶어요'
    | '따뜻하게 챙겨줘요'
    | '그냥 들어줘요'
    | '평소처럼 대해줘요';
  note?: string;
  periodStarted: boolean;
  periodEnded: boolean;
}

export interface DailyHistoryEntry {
  readonly localDate: string;
  readonly checkIn: DailyCheckIn;
  readonly updatedAt?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'queued' | 'synced' | 'error';

export interface NotificationQuietHours {
  readonly start: string;
  readonly end: string;
}

export interface EditablePairEvent extends PairEventInput {
  readonly isNew?: boolean;
}

export interface CyclePairState {
  schemaVersion: 4;
  stage: AppStage;
  activeTab: MainTab;
  currentLocalDate: string;
  isLogger: boolean;
  /** True only after the user explicitly supplied a complete prediction seed. */
  hasCycleSeed: boolean;
  seed: CycleSeed;
  paired: boolean;
  sharingCompleted: boolean;
  sharingPairId?: string;
  partnerName: string;
  partnerProjection?: RemotePartnerProjection;
  shareSettings: Record<ShareField, boolean>;
  shareSettingsDirty: boolean;
  checkIn: DailyCheckIn;
  dailyHistory: readonly DailyHistoryEntry[];
  sharedEvents: readonly PairEvent[];
  syncStatus: SyncStatus;
  neutralNotifications: boolean;
  notificationQuietHours: NotificationQuietHours;
  diagnosticsEnabled: boolean;
  sensitiveDataConsentAcceptedAt?: string;
  sensitiveDataConsentVersion?: string;
  lastSavedAt?: string;
}

interface PersistedShellPreferences {
  readonly schemaVersion: 4;
  readonly onboardingComplete: boolean;
  readonly neutralNotifications: boolean;
  readonly notificationQuietHours: NotificationQuietHours;
  readonly diagnosticsEnabled: boolean;
}

export type CyclePairAction =
  | { type: 'RESTORE_SHELL_PREFERENCES'; payload: PersistedShellPreferences }
  | {
      type: 'RESTORE_PRIVATE_SETUP';
      payload: {
        isLogger: boolean;
        seed?: CycleSeed;
        consentAcceptedAt: string;
        consentVersion?: string;
      };
    }
  | { type: 'COMPLETE_ONBOARDING' }
  | {
      type: 'COMPLETE_SETUP';
      payload: {
        isLogger: boolean;
        seed?: CycleSeed;
        consentAcceptedAt: string;
        consentVersion: string;
      };
    }
  | {
      type: 'UPDATE_PRIVATE_SETUP';
      payload: { isLogger: boolean; seed?: CycleSeed };
    }
  | { type: 'GO_BACK' }
  | { type: 'OPEN_PAIRING' }
  | { type: 'CONTINUE_TO_SHARING' }
  | { type: 'LINK_PARTNER'; payload: { pairId: string; name?: string } }
  | {
      type: 'RESTORE_SHARE_SETTINGS';
      payload: { pairId: string; settings: Record<ShareField, boolean> | null };
    }
  | { type: 'SET_PARTNER_PROJECTION'; payload?: RemotePartnerProjection }
  | { type: 'RESTORE_DAILY_HISTORY'; payload: readonly DailyHistoryEntry[] }
  | { type: 'MERGE_DAILY_HISTORY'; payload: readonly DailyHistoryEntry[] }
  | { type: 'REFRESH_TODAY'; payload: string }
  | { type: 'SET_PAIR_EVENTS'; payload: readonly PairEvent[] }
  | { type: 'SET_SYNC_STATUS'; payload: SyncStatus }
  | {
      type: 'SET_SHARE_SETTINGS';
      payload: Record<ShareField, boolean>;
      dirty?: boolean;
    }
  | { type: 'USE_RECOMMENDED_SHARING' }
  | { type: 'COMPLETE_SHARING'; queued?: boolean }
  | { type: 'SET_TAB'; payload: MainTab }
  | { type: 'SAVE_CHECK_IN'; payload: DailyCheckIn }
  | { type: 'DELETE_DAILY_LOG'; payload: string }
  | { type: 'SET_NOTIFICATIONS_ENABLED'; payload: boolean }
  | { type: 'SET_NOTIFICATION_QUIET_HOURS'; payload: NotificationQuietHours }
  | { type: 'SET_DIAGNOSTICS_ENABLED'; payload: boolean }
  | { type: 'DISCONNECT_PAIR' }
  | { type: 'RESET' };

function toLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysAgo(count: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - count);
  return toLocalDate(date);
}

function localDateDistance(from: string, to: string): number {
  const start = Date.parse(`${from}T12:00:00.000Z`);
  const end = Date.parse(`${to}T12:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

function observedAverageCycleLength(
  state: Pick<CyclePairState, 'dailyHistory' | 'seed'>,
  nextStart?: string,
): number {
  const starts = new Set<string>([state.seed.lastPeriodStart]);
  for (const entry of state.dailyHistory) {
    if (entry.checkIn.periodStarted) starts.add(entry.localDate);
  }
  if (nextStart) starts.add(nextStart);
  const sorted = [...starts].sort();
  const intervals = sorted
    .slice(1)
    .map((value, index) => localDateDistance(sorted[index]!, value))
    .filter(value => value >= 15 && value <= 60);
  if (intervals.length === 0) return state.seed.averageCycleLength;
  return Math.round(
    intervals.reduce((total, value) => total + value, 0) / intervals.length,
  );
}

function seedFromDailyHistory(
  seed: CycleSeed,
  dailyHistory: readonly DailyHistoryEntry[],
): CycleSeed {
  const observedStarts = dailyHistory
    .filter(entry => entry.checkIn.periodStarted)
    .map(entry => entry.localDate);
  const lastPeriodStart = [...observedStarts, seed.lastPeriodStart]
    .sort()
    .at(-1)!;
  const eligibleEnds = dailyHistory
    .filter(
      entry => entry.checkIn.periodEnded && entry.localDate >= lastPeriodStart,
    )
    .map(entry => entry.localDate);
  if (
    seed.lastPeriodEnd &&
    seed.lastPeriodStart === lastPeriodStart &&
    seed.lastPeriodEnd >= lastPeriodStart
  ) {
    eligibleEnds.push(seed.lastPeriodEnd);
  }
  const lastPeriodEnd = eligibleEnds.sort().at(-1);
  const averageCycleLength = observedAverageCycleLength({
    seed,
    dailyHistory,
  });

  return {
    ...seed,
    lastPeriodStart,
    ...(lastPeriodEnd ? { lastPeriodEnd } : { lastPeriodEnd: undefined }),
    averageCycleLength,
  };
}

function createMutationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

function cyclePersistenceKey(
  uid: string,
  asOfDate: string,
  consentAcceptedAt: string,
  seed: CycleSeed,
): string {
  return [
    uid,
    asOfDate,
    consentAcceptedAt,
    seed.lastPeriodStart,
    seed.lastPeriodEnd ?? '',
    seed.averageCycleLength,
    seed.averagePeriodLength,
  ].join('|');
}

const DEFAULT_NOTIFICATION_QUIET_HOURS: NotificationQuietHours = {
  start: '22:00',
  end: '08:00',
};
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function privateByDefault(): Record<ShareField, boolean> {
  return {
    cyclePhase: false,
    cycleStatus: false,
    fertilityStatus: false,
    predictedPeriod: false,
    periodDates: false,
    mood: false,
    symptoms: false,
    energy: false,
    condition: false,
    carePreference: false,
    note: false,
  };
}

function emptyDailyCheckIn(): DailyCheckIn {
  return {
    symptoms: [],
    periodStarted: false,
    periodEnded: false,
  };
}

function currentCheckInForRole(
  checkIn: DailyCheckIn | undefined,
  isLogger: boolean,
): DailyCheckIn {
  if (!checkIn) return emptyDailyCheckIn();
  if (isLogger) return checkIn;
  return {
    ...checkIn,
    periodStarted: false,
    periodEnded: false,
  };
}

export function createInitialState(): CyclePairState {
  return {
    schemaVersion: 4,
    stage: 'onboarding',
    activeTab: 'home',
    currentLocalDate: toLocalDate(new Date()),
    isLogger: true,
    hasCycleSeed: false,
    seed: {
      lastPeriodStart: daysAgo(4),
      averageCycleLength: 28,
      averagePeriodLength: 5,
    },
    paired: false,
    sharingCompleted: false,
    partnerName: '파트너',
    shareSettings: privateByDefault(),
    shareSettingsDirty: false,
    checkIn: emptyDailyCheckIn(),
    dailyHistory: [],
    sharedEvents: [],
    syncStatus: 'idle',
    neutralNotifications: false,
    notificationQuietHours: DEFAULT_NOTIFICATION_QUIET_HOURS,
    diagnosticsEnabled: false,
  };
}

export function reduceCyclePairState(
  state: CyclePairState,
  action: CyclePairAction,
): CyclePairState {
  switch (action.type) {
    case 'RESTORE_SHELL_PREFERENCES': {
      const restored = action.payload;
      return {
        ...state,
        stage: hasCurrentSensitiveHealthConsent(
          state.sensitiveDataConsentAcceptedAt!,
          state.sensitiveDataConsentVersion,
        )
          ? state.stage
          : restored.onboardingComplete
          ? 'setup'
          : 'onboarding',
        neutralNotifications: restored.neutralNotifications,
        notificationQuietHours: restored.notificationQuietHours,
        diagnosticsEnabled: restored.diagnosticsEnabled,
      };
    }
    case 'RESTORE_PRIVATE_SETUP': {
      const hasCurrentConsent = hasCurrentSensitiveHealthConsent(
        action.payload.consentAcceptedAt,
        action.payload.consentVersion,
      );
      return {
        ...state,
        isLogger: action.payload.isLogger,
        hasCycleSeed:
          action.payload.isLogger && action.payload.seed !== undefined,
        ...(action.payload.seed ? { seed: action.payload.seed } : {}),
        sensitiveDataConsentAcceptedAt: hasCurrentConsent
          ? action.payload.consentAcceptedAt
          : undefined,
        sensitiveDataConsentVersion: hasCurrentConsent
          ? action.payload.consentVersion
          : undefined,
        stage: hasCurrentConsent
          ? state.paired
            ? state.sharingCompleted
              ? 'main'
              : 'sharing'
            : 'main'
          : 'setup',
        activeTab: state.paired ? state.activeTab : 'home',
      };
    }
    case 'COMPLETE_ONBOARDING':
      return { ...state, stage: 'setup' };
    case 'COMPLETE_SETUP':
      return {
        ...state,
        isLogger: action.payload.isLogger,
        hasCycleSeed:
          action.payload.isLogger && action.payload.seed !== undefined,
        ...(action.payload.seed ? { seed: action.payload.seed } : {}),
        sensitiveDataConsentAcceptedAt: action.payload.consentAcceptedAt,
        sensitiveDataConsentVersion: action.payload.consentVersion,
        stage: state.paired
          ? state.sharingCompleted
            ? 'main'
            : 'sharing'
          : 'main',
        activeTab: state.paired ? state.activeTab : 'home',
      };
    case 'UPDATE_PRIVATE_SETUP':
      return {
        ...state,
        isLogger: action.payload.isLogger,
        hasCycleSeed:
          action.payload.isLogger && action.payload.seed !== undefined,
        ...(action.payload.seed ? { seed: action.payload.seed } : {}),
        checkIn: action.payload.isLogger
          ? state.checkIn
          : {
              ...state.checkIn,
              periodStarted: false,
              periodEnded: false,
            },
      };
    case 'GO_BACK':
      if (state.stage === 'setup') return { ...state, stage: 'onboarding' };
      if (state.stage === 'invite') {
        return { ...state, stage: 'main', activeTab: 'partner' };
      }
      if (state.stage === 'sharing') return { ...state, stage: 'invite' };
      return state;
    case 'OPEN_PAIRING':
      if (state.stage !== 'main' || state.paired) return state;
      return { ...state, stage: 'invite', activeTab: 'partner' };
    case 'CONTINUE_TO_SHARING':
      if (
        (state.stage !== 'invite' && state.stage !== 'main') ||
        !state.paired ||
        !state.sharingPairId
      )
        return state;
      return { ...state, stage: 'sharing' };
    case 'LINK_PARTNER':
      if (state.sharingPairId === action.payload.pairId) {
        return {
          ...state,
          paired: true,
          partnerName: action.payload.name ?? state.partnerName,
          stage:
            state.stage === 'onboarding' || state.stage === 'setup'
              ? state.stage
              : state.stage === 'invite' && state.paired
              ? 'invite'
              : state.sharingCompleted
              ? 'main'
              : 'sharing',
        };
      }
      return {
        ...state,
        paired: true,
        sharingPairId: action.payload.pairId,
        sharingCompleted: false,
        shareSettings: privateByDefault(),
        shareSettingsDirty: false,
        partnerProjection: undefined,
        partnerName: action.payload.name ?? state.partnerName,
        stage:
          state.stage === 'onboarding' || state.stage === 'setup'
            ? state.stage
            : 'sharing',
      };
    case 'RESTORE_SHARE_SETTINGS':
      if (state.sharingPairId !== action.payload.pairId) return state;
      if (state.shareSettingsDirty) return state;
      if (!action.payload.settings) {
        return {
          ...state,
          sharingCompleted: false,
          shareSettings:
            state.stage === 'invite' && state.paired
              ? state.shareSettings
              : privateByDefault(),
          stage:
            state.stage === 'onboarding' ||
            state.stage === 'setup' ||
            (state.stage === 'invite' && state.paired)
              ? state.stage
              : 'sharing',
        };
      }
      return {
        ...state,
        sharingCompleted: true,
        shareSettings: action.payload.settings,
        shareSettingsDirty: false,
        stage:
          state.stage === 'onboarding' ||
          state.stage === 'setup' ||
          (state.stage === 'invite' && state.paired)
            ? state.stage
            : 'main',
      };
    case 'SET_PARTNER_PROJECTION':
      return {
        ...state,
        ...(action.payload
          ? { partnerProjection: action.payload }
          : { partnerProjection: undefined }),
      };
    case 'RESTORE_DAILY_HISTORY': {
      const today = toLocalDate(new Date());
      const todayEntry = action.payload.find(
        entry => entry.localDate === today,
      );
      return {
        ...state,
        dailyHistory: action.payload,
        seed: state.hasCycleSeed
          ? seedFromDailyHistory(state.seed, action.payload)
          : state.seed,
        checkIn: currentCheckInForRole(todayEntry?.checkIn, state.isLogger),
      };
    }
    case 'MERGE_DAILY_HISTORY': {
      const byDate = new Map(
        action.payload.map(entry => [entry.localDate, entry] as const),
      );
      for (const entry of state.dailyHistory) {
        byDate.set(entry.localDate, entry);
      }
      const dailyHistory = [...byDate.values()].sort((left, right) =>
        right.localDate.localeCompare(left.localDate),
      );
      const todayEntry = dailyHistory.find(
        entry => entry.localDate === state.currentLocalDate,
      );
      return {
        ...state,
        dailyHistory,
        seed: state.hasCycleSeed
          ? seedFromDailyHistory(state.seed, dailyHistory)
          : state.seed,
        checkIn: currentCheckInForRole(todayEntry?.checkIn, state.isLogger),
      };
    }
    case 'REFRESH_TODAY': {
      const todayEntry = state.dailyHistory.find(
        entry => entry.localDate === action.payload,
      );
      return {
        ...state,
        currentLocalDate: action.payload,
        checkIn: currentCheckInForRole(todayEntry?.checkIn, state.isLogger),
      };
    }
    case 'SET_PAIR_EVENTS':
      return { ...state, sharedEvents: action.payload };
    case 'SET_SYNC_STATUS':
      return { ...state, syncStatus: action.payload };
    case 'SET_SHARE_SETTINGS':
      if (!state.paired || !state.sharingPairId) return state;
      return {
        ...state,
        shareSettings: action.payload,
        shareSettingsDirty: action.dirty !== false,
      };
    case 'USE_RECOMMENDED_SHARING':
      if (!state.paired || !state.sharingPairId) return state;
      return {
        ...state,
        shareSettings: {
          cyclePhase: true,
          cycleStatus: true,
          fertilityStatus: true,
          predictedPeriod: true,
          periodDates: false,
          mood: true,
          symptoms: false,
          energy: false,
          condition: true,
          carePreference: true,
          note: false,
        },
        shareSettingsDirty: true,
      };
    case 'COMPLETE_SHARING':
      if (state.stage !== 'sharing' || !state.paired || !state.sharingPairId)
        return state;
      return {
        ...state,
        sharingCompleted: true,
        shareSettingsDirty: action.queued === true,
        stage: 'main',
        activeTab: 'home',
      };
    case 'SET_TAB':
      return { ...state, activeTab: action.payload };
    case 'SAVE_CHECK_IN': {
      const today = toLocalDate(new Date());
      const history = [
        { localDate: today, checkIn: action.payload },
        ...state.dailyHistory.filter(entry => entry.localDate !== today),
      ].sort((left, right) => right.localDate.localeCompare(left.localDate));
      return {
        ...state,
        checkIn: action.payload,
        dailyHistory: history,
        seed:
          state.hasCycleSeed && action.payload.periodStarted
            ? {
                ...state.seed,
                lastPeriodStart: today,
                lastPeriodEnd: undefined,
                averageCycleLength: observedAverageCycleLength(state, today),
              }
            : state.hasCycleSeed && action.payload.periodEnded
            ? { ...state.seed, lastPeriodEnd: today }
            : state.seed,
        lastSavedAt: new Date().toISOString(),
      };
    }
    case 'DELETE_DAILY_LOG':
      return {
        ...state,
        dailyHistory: state.dailyHistory.filter(
          entry => entry.localDate !== action.payload,
        ),
        checkIn:
          action.payload === state.currentLocalDate
            ? emptyDailyCheckIn()
            : state.checkIn,
        lastSavedAt: new Date().toISOString(),
      };
    case 'SET_NOTIFICATIONS_ENABLED':
      return { ...state, neutralNotifications: action.payload };
    case 'SET_NOTIFICATION_QUIET_HOURS':
      return { ...state, notificationQuietHours: action.payload };
    case 'SET_DIAGNOSTICS_ENABLED':
      return { ...state, diagnosticsEnabled: action.payload };
    case 'DISCONNECT_PAIR':
      if (!state.paired) {
        return {
          ...state,
          partnerProjection: undefined,
        };
      }
      return {
        ...state,
        paired: false,
        sharingPairId: undefined,
        sharingCompleted: false,
        stage: hasCurrentSensitiveHealthConsent(
          state.sensitiveDataConsentAcceptedAt,
          state.sensitiveDataConsentVersion,
        )
          ? 'main'
          : 'setup',
        activeTab: hasCurrentSensitiveHealthConsent(
          state.sensitiveDataConsentAcceptedAt,
          state.sensitiveDataConsentVersion,
        )
          ? 'partner'
          : state.activeTab,
        partnerProjection: undefined,
        sharedEvents: [],
        shareSettings: privateByDefault(),
        shareSettingsDirty: false,
      };
    case 'RESET':
      return createInitialState();
  }
}

function backendErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  if (code.includes('network'))
    return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
  if (code.includes('resource-exhausted'))
    return '초대 생성 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.';
  if (code.includes('failed-precondition'))
    return '초대가 만료됐거나 이미 사용됐습니다.';
  if (code.includes('permission-denied'))
    return '현재 계정으로 접근할 수 없습니다.';
  if (code.includes('unauthenticated'))
    return '로그인 상태를 다시 확인해 주세요.';
  return '동기화 중 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.';
}

function partnerNudgeRetryAt(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = error as {
    details?: unknown;
    customData?: { details?: unknown };
  };
  const details =
    typeof value.details === 'object' && value.details !== null
      ? (value.details as { nextAllowedAt?: unknown })
      : typeof value.customData?.details === 'object' &&
        value.customData.details !== null
      ? (value.customData.details as { nextAllowedAt?: unknown })
      : undefined;
  const nextAllowedAt = details?.nextAllowedAt;
  return typeof nextAllowedAt === 'string' &&
    Number.isFinite(Date.parse(nextAllowedAt))
    ? nextAllowedAt
    : undefined;
}

function failureCode(error: unknown): SafeFailureCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  if (code.includes('network') || code.includes('unavailable'))
    return 'network-failed';
  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return 'permission-denied';
  }
  if (code.includes('invalid') || code.includes('argument'))
    return 'validation-failed';
  if (code.includes('failed-precondition')) return 'invalid-state';
  return 'unknown-failure';
}

function currentNotificationEnvironment(quietHours: NotificationQuietHours): {
  readonly platform: 'android' | 'ios';
  readonly locale: string;
  readonly quietHours: QuietHours;
} {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    locale: resolved.locale || 'ko-KR',
    quietHours: {
      ...quietHours,
      timeZone: resolved.timeZone || 'Etc/UTC',
    },
  };
}

const noopNotificationClient: NotificationClient = {
  async enable() {
    return 'authorized';
  },
  async disable() {},
  async disableForAccountExit() {},
  watchTokenRefresh() {
    return () => undefined;
  },
  watchOpened() {
    return () => undefined;
  },
};

const noopAnalytics: ProductAnalytics = {
  async setEnabled() {},
  async track() {},
};

const noopCrashReporter: SafeCrashReporter = {
  async setEnabled() {},
  async recordFailure() {},
};

interface CyclePairContextValue {
  state: CyclePairState;
  isHydrating: boolean;
  backendKind: BackendKind;
  backendSession: BackendSession | null;
  activePair: ActivePairMembership | null;
  invite: PairInvite | null;
  backendBusy: boolean;
  notificationBusy: boolean;
  diagnosticsBusy: boolean;
  backendError: string | null;
  inAppNotices: readonly InAppNotice[];
  toastNotice: InAppNotice | null;
  partnerNudgeState: PartnerNudgeState;
  nudgeBusy: boolean;
  nudgeFeedback: string | null;
  clearBackendError(): void;
  dismissToastNotice(): void;
  openInAppNotice(noticeId: string): void;
  completeOnboarding(): void;
  goBack(): boolean;
  openPairing(): void;
  continueToSharing(): void;
  completeSetup(payload: {
    isLogger: boolean;
    seed?: CycleSeed;
    consentAcceptedAt: string;
    consentVersion: string;
  }): Promise<void>;
  updatePrivateSetup(payload: {
    isLogger: boolean;
    seed?: CycleSeed;
  }): Promise<boolean>;
  createInvite(): Promise<void>;
  acceptInvite(inviteToken: string): Promise<void>;
  previewLinkPartner(): void;
  toggleShare(field: ShareField): Promise<void>;
  useRecommendedSharing(): void;
  completeSharing(): Promise<void>;
  setTab(tab: MainTab): void;
  saveCheckIn(checkIn: DailyCheckIn): Promise<boolean>;
  deleteDailyLog(localDate: string): Promise<boolean>;
  upsertPairEvent(event: PairEventInput): Promise<boolean>;
  deletePairEvent(eventId: string): Promise<boolean>;
  sendPartnerNudge(type: PartnerNudgeType): Promise<boolean>;
  acknowledgePartnerNudge(): Promise<boolean>;
  toggleNotifications(): Promise<void>;
  updateNotificationQuietHours(start: string, end: string): Promise<boolean>;
  toggleDiagnostics(): Promise<void>;
  disconnectPair(): Promise<void>;
  resetApp(): void;
}

const CyclePairContext = createContext<CyclePairContextValue | null>(null);

export function CyclePairProvider({
  children,
  storage = asyncStorageCyclePairStateStorage,
  backend = previewCyclePairBackend,
  notificationClient = noopNotificationClient,
  analytics = noopAnalytics,
  crashReporter = noopCrashReporter,
}: PropsWithChildren<{
  storage?: CyclePairStateStorage;
  backend?: CyclePairBackend;
  notificationClient?: NotificationClient;
  analytics?: ProductAnalytics;
  crashReporter?: SafeCrashReporter;
}>) {
  const [state, dispatch] = useReducer(
    reduceCyclePairState,
    undefined,
    createInitialState,
  );
  const [localHydrating, setLocalHydrating] = useState(true);
  const [backendHydrating, setBackendHydrating] = useState(true);
  const [backendSession, setBackendSession] = useState<BackendSession | null>(
    null,
  );
  const [activePair, setActivePair] = useState<ActivePairMembership | null>(
    null,
  );
  const activePairRef = useRef<ActivePairMembership | null>(null);
  const [invite, setInvite] = useState<PairInvite | null>(null);
  const [backendBusy, setBackendBusy] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [inAppNotices, setInAppNotices] = useState<readonly InAppNotice[]>([]);
  const [toastNotice, setToastNotice] = useState<InAppNotice | null>(null);
  const [partnerNudgeState, setPartnerNudgeState] = useState<PartnerNudgeState>(
    {
      received: null,
      nextAllowedAt: {},
    },
  );
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const [nudgeFeedback, setNudgeFeedback] = useState<string | null>(null);
  const inAppNoticesRef = useRef<readonly InAppNotice[]>([]);
  const noticeSequence = useRef(0);
  const shareWriteChain = useRef<Promise<void>>(Promise.resolve());
  const lastCyclePersistenceKey = useRef('');
  const initialDailyHistoryLoad = useRef<Promise<void> | null>(null);
  const latestState = useRef(state);
  latestState.current = state;

  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshToday = () => {
      dispatch({ type: 'REFRESH_TODAY', payload: toDeviceLocalDate() });
    };
    const scheduleMidnightRefresh = () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 50);
      midnightTimer = setTimeout(() => {
        refreshToday();
        scheduleMidnightRefresh();
      }, Math.max(1_000, nextMidnight.getTime() - now.getTime()));
    };

    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        if (nextState !== 'active') return;
        refreshToday();
        scheduleMidnightRefresh();
      },
    );
    scheduleMidnightRefresh();

    return () => {
      appStateSubscription.remove();
      if (midnightTimer) clearTimeout(midnightTimer);
    };
  }, []);

  const reportFailure = useCallback(
    (
      error: unknown,
      surface: CrashSurface = 'startup',
      operation = 'background-sync',
      retryable = true,
    ) => {
      setBackendError(backendErrorMessage(error));
      crashReporter
        .recordFailure(failureCode(error), { surface, operation, retryable })
        .catch(() => undefined);
    },
    [crashReporter],
  );

  const reportBackendError = useCallback(
    (error: unknown) => reportFailure(error),
    [reportFailure],
  );

  const enqueueInAppNotice = useCallback((kind: InAppNoticeKind) => {
    const copy = noticeCopy(kind);
    const notice: InAppNotice = {
      id: `notice-${Date.now().toString(36)}-${++noticeSequence.current}`,
      kind,
      ...copy,
    };
    setInAppNotices(current => {
      const next = [notice, ...current].slice(0, 5);
      inAppNoticesRef.current = next;
      return next;
    });
    setToastNotice(notice);
  }, []);

  const dismissToastNotice = useCallback(() => setToastNotice(null), []);
  const openInAppNotice = useCallback((noticeId: string) => {
    const notice = inAppNoticesRef.current.find(item => item.id === noticeId);
    if (!notice) return;
    dispatch({ type: 'SET_TAB', payload: notice.destination });
    setInAppNotices(current => {
      const next = current.filter(item => item.id !== noticeId);
      inAppNoticesRef.current = next;
      return next;
    });
    setToastNotice(current => (current?.id === noticeId ? null : current));
  }, []);

  useEffect(() => {
    if (
      !backendSession ||
      !state.isLogger ||
      !state.hasCycleSeed ||
      !hasCurrentSensitiveHealthConsent(
        state.sensitiveDataConsentAcceptedAt,
        state.sensitiveDataConsentVersion,
      )
    ) {
      return;
    }
    let active = true;
    const persistenceKey = cyclePersistenceKey(
      backendSession.uid,
      state.currentLocalDate,
      state.sensitiveDataConsentAcceptedAt!,
      state.seed,
    );
    if (lastCyclePersistenceKey.current === persistenceKey) {
      return;
    }
    lastCyclePersistenceKey.current = persistenceKey;
    backend
      .savePrivateSetup(
        backendSession.uid,
        true,
        state.sensitiveDataConsentAcceptedAt!,
        state.sensitiveDataConsentVersion!,
        toPrivateCycleRecord(state.seed),
      )
      .then(write => {
        if (active && write.status === 'queued') {
          dispatch({ type: 'SET_SYNC_STATUS', payload: 'queued' });
        }
      })
      .catch(error => {
        if (active) {
          if (lastCyclePersistenceKey.current === persistenceKey) {
            lastCyclePersistenceKey.current = '';
          }
          reportFailure(error, 'startup', 'refresh-cycle-projection', true);
        }
      });
    return () => {
      active = false;
    };
  }, [
    backend,
    backendSession,
    reportFailure,
    state.currentLocalDate,
    state.hasCycleSeed,
    state.isLogger,
    state.seed,
    state.sensitiveDataConsentAcceptedAt,
    state.sensitiveDataConsentVersion,
  ]);

  useEffect(() => {
    let active = true;
    storage
      .read()
      .then(value => {
        if (!active || !value) return;
        const persisted = JSON.parse(value) as {
          schemaVersion?: 2 | 3 | 4;
          onboardingComplete?: unknown;
          neutralNotifications?: unknown;
          notificationQuietHours?: unknown;
          diagnosticsEnabled?: unknown;
        };
        if (
          persisted.schemaVersion !== 2 &&
          persisted.schemaVersion !== 3 &&
          persisted.schemaVersion !== 4
        )
          return;
        const quietHours =
          typeof persisted.notificationQuietHours === 'object' &&
          persisted.notificationQuietHours !== null
            ? (persisted.notificationQuietHours as Record<string, unknown>)
            : {};
        const restoredQuietHours =
          typeof quietHours.start === 'string' &&
          typeof quietHours.end === 'string' &&
          LOCAL_TIME.test(quietHours.start) &&
          LOCAL_TIME.test(quietHours.end) &&
          quietHours.start !== quietHours.end
            ? { start: quietHours.start, end: quietHours.end }
            : DEFAULT_NOTIFICATION_QUIET_HOURS;
        dispatch({
          type: 'RESTORE_SHELL_PREFERENCES',
          payload: {
            schemaVersion: 4,
            onboardingComplete: persisted.onboardingComplete === true,
            // Older schemas defaulted notifications on without explicit OS
            // permission. Migration deliberately resets them to opt-in.
            neutralNotifications:
              persisted.schemaVersion === 4 &&
              persisted.neutralNotifications === true,
            notificationQuietHours: restoredQuietHours,
            diagnosticsEnabled:
              persisted.schemaVersion === 4 &&
              persisted.diagnosticsEnabled === true,
          },
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLocalHydrating(false);
      });

    return () => {
      active = false;
    };
  }, [storage]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await backend.initialize();
        if (!active) return;
        // Pair membership is an authorization boundary. Device cache may be
        // stale after another device acknowledges a revoke tombstone, so only
        // the live membership watcher is allowed to restore Pair UI/events.
        const setupResult = await Promise.resolve(
          backend.loadPrivateSetup(session.uid),
        ).then(
          value => ({ status: 'fulfilled' as const, value }),
          reason => ({ status: 'rejected' as const, reason }),
        );
        if (!active) return;
        if (setupResult.status === 'fulfilled' && setupResult.value) {
          const setup = setupResult.value;
          dispatch({
            type: 'RESTORE_PRIVATE_SETUP',
            payload: {
              isLogger: setup.recordsCycle,
              consentAcceptedAt: setup.consentAcceptedAt,
              consentVersion: setup.consentVersion,
              ...(setup.cycle
                ? {
                    seed: {
                      lastPeriodStart: setup.cycle.periodDates.startDate,
                      ...(setup.cycle.periodDates.endDate
                        ? { lastPeriodEnd: setup.cycle.periodDates.endDate }
                        : {}),
                      averageCycleLength: setup.cycle.averageCycleLength,
                      averagePeriodLength: setup.cycle.averagePeriodLength,
                    },
                  }
                : {}),
            },
          });
        }
        if (setupResult.status === 'rejected') {
          reportBackendError(setupResult.reason);
        }
        // Authentication and the encrypted mutation queue remain usable even
        // when uncached Firestore reads fail while the device is offline.
        setBackendSession(session);
        // Historical records are not required to decide the startup route.
        // Restore the complete encrypted cache before starting remote sync so
        // neither rendering nor long-term cycle history waits on Firestore.
        setBackendHydrating(false);
        const dailyHistoryLoad = backend
          .loadCachedDailyLogs(session.uid)
          .then(dailyLogs => {
            if (!active) return;
            dispatch({
              type: 'MERGE_DAILY_HISTORY',
              payload: dailyLogs.map(fromPrivateDailyLogSnapshot),
            });
          })
          .catch(error => {
            if (active) reportBackendError(error);
          })
          .then(() => backend.syncDailyLogs(session.uid))
          .then(dailyLogs => {
            if (!active) return;
            dispatch({
              type: 'RESTORE_DAILY_HISTORY',
              payload: dailyLogs.map(fromPrivateDailyLogSnapshot),
            });
          })
          .catch(error => {
            if (active) reportBackendError(error);
          });
        initialDailyHistoryLoad.current = dailyHistoryLoad;
        dailyHistoryLoad.then(() => {
          if (initialDailyHistoryLoad.current === dailyHistoryLoad) {
            initialDailyHistoryLoad.current = null;
          }
        });
      } catch (error) {
        reportBackendError(error);
      } finally {
        if (active) setBackendHydrating(false);
      }
    })().catch(reportBackendError);
    return () => {
      active = false;
    };
  }, [backend, reportBackendError]);

  useEffect(() => {
    if (!backendSession) return;
    const stopPair = backend.watchActivePair(
      backendSession.uid,
      membership => {
        activePairRef.current = membership;
        setActivePair(current =>
          current?.pairId === membership?.pairId &&
          current?.partnerUid === membership?.partnerUid
            ? current
            : membership,
        );
        if (membership) {
          dispatch({
            type: 'LINK_PARTNER',
            payload: { pairId: membership.pairId, name: '파트너' },
          });
        } else {
          dispatch({ type: 'DISCONNECT_PAIR' });
        }
      },
      reportBackendError,
    );
    const stopTombstones = backend.watchPendingTombstones(
      backendSession.uid,
      tombstones => {
        for (const tombstone of tombstones) {
          (async () => {
            const currentPair = activePairRef.current;
            if (!currentPair || currentPair.pairId === tombstone.pairId) {
              // Hide revoked data immediately even if strict Keychain cleanup
              // fails and must be retried before tombstone acknowledgement.
              activePairRef.current = null;
              setActivePair(null);
              dispatch({ type: 'DISCONNECT_PAIR' });
            }
            await backend.clearPendingPairMutations(
              backendSession.uid,
              tombstone.pairId,
            );
            await backend.acknowledgeCacheTombstone(tombstone.id);
            const report = await backend.flushPendingMutations(
              backendSession.uid,
            );
            dispatch({
              type: 'SET_SYNC_STATUS',
              payload:
                report.failed > 0
                  ? 'error'
                  : report.remaining > 0
                  ? 'queued'
                  : 'synced',
            });
          })().catch(reportBackendError);
        }
      },
      reportBackendError,
    );
    return () => {
      stopPair();
      stopTombstones();
    };
  }, [backend, backendSession, reportBackendError]);

  useEffect(() => {
    setPartnerNudgeState({ received: null, nextAllowedAt: {} });
    setNudgeFeedback(null);
  }, [activePair?.pairId]);

  useEffect(() => {
    if (!activePair || !backendSession) return;
    let active = true;
    let projectionInitialized = false;
    let previousProjection: RemotePartnerProjection | null = null;
    let eventsInitialized = false;
    let previousEvents: readonly PairEvent[] = [];
    const stopProjection = backend.watchPartnerProjection(
      activePair,
      projection => {
        if (!active) return;
        if (
          projectionInitialized &&
          hasMeaningfulPartnerProjectionChange(previousProjection, projection)
        ) {
          enqueueInAppNotice('partner-record');
        }
        projectionInitialized = true;
        previousProjection = projection;
        dispatch({
          type: 'SET_PARTNER_PROJECTION',
          ...(projection ? { payload: projection } : {}),
        });
      },
      reportBackendError,
    );
    const stopSettings = backend.watchShareSettings(
      backendSession.uid,
      activePair.pairId,
      settings =>
        dispatch({
          type: 'RESTORE_SHARE_SETTINGS',
          payload: {
            pairId: activePair.pairId,
            settings: settings ? fromBackendShareSettings(settings) : null,
          },
        }),
      reportBackendError,
    );
    const stopEvents = backend.watchPairEvents(
      activePair,
      events => {
        if (!active) return;
        if (
          eventsInitialized &&
          hasPartnerPairEventUpdate(
            previousEvents,
            events,
            activePair.partnerUid,
          )
        ) {
          enqueueInAppNotice('shared-event');
        }
        eventsInitialized = true;
        previousEvents = events;
        dispatch({ type: 'SET_PAIR_EVENTS', payload: events });
      },
      reportBackendError,
    );
    const stopNudges = backend.watchPartnerNudgeState(
      backendSession.uid,
      activePair,
      value => {
        if (active) setPartnerNudgeState(value);
      },
      reportBackendError,
    );
    return () => {
      active = false;
      stopProjection();
      stopSettings();
      stopEvents();
      stopNudges();
    };
  }, [
    activePair,
    backend,
    backendSession,
    enqueueInAppNotice,
    reportBackendError,
  ]);

  useEffect(() => {
    inAppNoticesRef.current = [];
    setInAppNotices([]);
    setToastNotice(null);
  }, [activePair?.pairId]);

  useEffect(() => {
    if (localHydrating) return;
    const preferences: PersistedShellPreferences = {
      schemaVersion: 4,
      onboardingComplete: state.stage !== 'onboarding',
      neutralNotifications: state.neutralNotifications,
      notificationQuietHours: state.notificationQuietHours,
      diagnosticsEnabled: state.diagnosticsEnabled,
    };
    storage.write(JSON.stringify(preferences)).catch(reportBackendError);
  }, [
    localHydrating,
    reportBackendError,
    state.neutralNotifications,
    state.notificationQuietHours,
    state.diagnosticsEnabled,
    state.stage,
    storage,
  ]);

  useEffect(() => {
    if (localHydrating) return;
    Promise.all([
      analytics.setEnabled(state.diagnosticsEnabled),
      crashReporter.setEnabled(state.diagnosticsEnabled),
    ]).catch(error => {
      reportFailure(error, 'startup', 'configure-diagnostics', false);
    });
  }, [
    analytics,
    crashReporter,
    localHydrating,
    reportFailure,
    state.diagnosticsEnabled,
  ]);

  useEffect(
    () =>
      notificationClient.watchOpened(
        payload => {
          // The provider only exists after AccountProvider has restored a
          // valid session. Firestore watchers and Rules re-check Pair access.
          dispatch({
            type: 'SET_TAB',
            payload: payload.destination === 'calendar' ? 'calendar' : 'home',
          });
        },
        error =>
          reportFailure(error, 'notification', 'open-notification', false),
      ),
    [notificationClient, reportFailure],
  );

  useEffect(() => {
    if (localHydrating || !state.neutralNotifications) return;
    let active = true;
    let stopRefresh: () => void = () => undefined;
    const input = currentNotificationEnvironment(state.notificationQuietHours);
    setNotificationBusy(true);
    notificationClient
      .enable(input)
      .then(async permission => {
        if (!active) return;
        if (permission !== 'authorized') {
          try {
            // Permission may have been revoked after an earlier registration.
            // Remove both the server document and local FCM token first.
            await notificationClient.disable();
          } catch (error) {
            if (active) {
              reportFailure(error, 'notification', 'unregister-device', true);
            }
          }
          if (!active) return;
          dispatch({ type: 'SET_NOTIFICATIONS_ENABLED', payload: false });
          setBackendError(
            '알림 권한이 허용되지 않았습니다. 기기 설정에서 다시 켤 수 있어요.',
          );
          return;
        }
        // Refresh can write a device registration. Subscribe only after both
        // native permission and the initial server registration succeeded.
        stopRefresh = notificationClient.watchTokenRefresh(input, error =>
          reportFailure(error, 'notification', 'refresh-token', true),
        );
      })
      .catch(error => {
        if (!active) return;
        dispatch({ type: 'SET_NOTIFICATIONS_ENABLED', payload: false });
        reportFailure(error, 'notification', 'register-device', true);
        notificationClient.disable().catch(() => undefined);
      })
      .finally(() => {
        if (active) setNotificationBusy(false);
      });
    return () => {
      active = false;
      stopRefresh();
    };
  }, [
    localHydrating,
    notificationClient,
    reportFailure,
    state.neutralNotifications,
    state.notificationQuietHours,
  ]);

  useEffect(
    () => () => {
      // AccountProvider performs account-bound FCM unregister before Auth
      // sign-out/deletion. An unmount cleanup must never call getToken after
      // the identity changed because that can create a token for the next UID.
      analytics.setEnabled(false).catch(() => undefined);
      crashReporter.setEnabled(false).catch(() => undefined);
    },
    [analytics, crashReporter],
  );

  const completeOnboarding = useCallback(() => {
    dispatch({ type: 'COMPLETE_ONBOARDING' });
    analytics.track({ name: 'cp_onboarding_complete' }).catch(() => undefined);
  }, [analytics]);
  const goBack = useCallback(() => {
    if (
      state.stage !== 'setup' &&
      state.stage !== 'invite' &&
      state.stage !== 'sharing'
    )
      return false;
    if (backendBusy) return true;
    dispatch({ type: 'GO_BACK' });
    return true;
  }, [backendBusy, state.stage]);
  const openPairing = useCallback(() => dispatch({ type: 'OPEN_PAIRING' }), []);
  const continueToSharing = useCallback(
    () => dispatch({ type: 'CONTINUE_TO_SHARING' }),
    [],
  );
  const completeSetup = useCallback(
    async (payload: {
      isLogger: boolean;
      seed?: CycleSeed;
      consentAcceptedAt: string;
      consentVersion: string;
    }) => {
      if (!backendSession) {
        reportBackendError(new Error('backend session unavailable'));
        return;
      }
      setBackendBusy(true);
      setBackendError(null);
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
      try {
        if (payload.consentVersion !== SENSITIVE_HEALTH_CONSENT_VERSION) {
          throw new Error('current sensitive health consent unavailable');
        }
        const write = await backend.savePrivateSetup(
          backendSession.uid,
          payload.isLogger,
          payload.consentAcceptedAt,
          payload.consentVersion,
          payload.isLogger && payload.seed
            ? toPrivateCycleRecord(payload.seed)
            : undefined,
        );
        if (payload.isLogger && payload.seed) {
          lastCyclePersistenceKey.current = cyclePersistenceKey(
            backendSession.uid,
            state.currentLocalDate,
            payload.consentAcceptedAt,
            payload.seed,
          );
        }
        dispatch({ type: 'COMPLETE_SETUP', payload });
        dispatch({ type: 'SET_SYNC_STATUS', payload: write.status });
      } catch (error) {
        dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
        reportFailure(error, 'startup', 'save-private-setup', true);
      } finally {
        setBackendBusy(false);
      }
    },
    [
      backend,
      backendSession,
      reportBackendError,
      reportFailure,
      state.currentLocalDate,
    ],
  );
  const updatePrivateSetup = useCallback(
    async (payload: { isLogger: boolean; seed?: CycleSeed }) => {
      if (
        !backendSession ||
        !hasCurrentSensitiveHealthConsent(
          state.sensitiveDataConsentAcceptedAt!,
          state.sensitiveDataConsentVersion,
        )
      ) {
        reportBackendError(new Error('backend session unavailable'));
        return false;
      }
      setBackendBusy(true);
      setBackendError(null);
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
      try {
        const write = await backend.savePrivateSetup(
          backendSession.uid,
          payload.isLogger,
          state.sensitiveDataConsentAcceptedAt!,
          state.sensitiveDataConsentVersion!,
          payload.isLogger && payload.seed
            ? toPrivateCycleRecord(payload.seed)
            : undefined,
        );
        if (payload.isLogger && payload.seed) {
          lastCyclePersistenceKey.current = cyclePersistenceKey(
            backendSession.uid,
            state.currentLocalDate,
            state.sensitiveDataConsentAcceptedAt!,
            payload.seed,
          );
        }
        dispatch({ type: 'UPDATE_PRIVATE_SETUP', payload });
        dispatch({ type: 'SET_SYNC_STATUS', payload: write.status });
        return true;
      } catch (error) {
        dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
        reportFailure(error, 'startup', 'save-private-setup', true);
        return false;
      } finally {
        setBackendBusy(false);
      }
    },
    [
      backend,
      backendSession,
      reportBackendError,
      reportFailure,
      state.currentLocalDate,
      state.sensitiveDataConsentAcceptedAt,
      state.sensitiveDataConsentVersion,
    ],
  );
  const createInvite = useCallback(async () => {
    setBackendBusy(true);
    setBackendError(null);
    try {
      setInvite(await backend.createPairInvite(state.isLogger));
      await analytics
        .track({ name: 'cp_pair_invite_created' })
        .catch(() => undefined);
    } catch (error) {
      reportFailure(error, 'pair', 'create-invite', true);
    } finally {
      setBackendBusy(false);
    }
  }, [analytics, backend, reportFailure, state.isLogger]);
  const acceptInvite = useCallback(
    async (inviteToken: string) => {
      setBackendBusy(true);
      setBackendError(null);
      try {
        await backend.acceptPairInvite(inviteToken, state.isLogger);
        await analytics
          .track({ name: 'cp_pair_connected' })
          .catch(() => undefined);
      } catch (error) {
        reportFailure(error, 'pair', 'accept-invite', true);
      } finally {
        setBackendBusy(false);
      }
    },
    [analytics, backend, reportFailure, state.isLogger],
  );
  const previewLinkPartner = useCallback(() => {
    if (backend.kind === 'preview') {
      dispatch({
        type: 'LINK_PARTNER',
        payload: { pairId: 'preview-pair', name: '다온' },
      });
    }
  }, [backend.kind]);
  const persistShareSettings = useCallback(
    (settings: Record<ShareField, boolean>): Promise<BackendWriteResult> => {
      if (!backendSession || !state.sharingPairId) {
        return Promise.reject(new Error('backend session unavailable'));
      }
      const write = () =>
        backend.saveShareSettings(
          backendSession.uid,
          state.sharingPairId!,
          toBackendShareSettings(settings),
        );
      const result = shareWriteChain.current.then(write, write);
      shareWriteChain.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [backend, backendSession, state.sharingPairId],
  );
  const toggleShare = useCallback(
    async (payload: ShareField) => {
      if (backendBusy || !state.paired || !state.sharingPairId) return;
      const nextSettings = {
        ...state.shareSettings,
        [payload]: !state.shareSettings[payload],
      };
      if (!state.sharingCompleted) {
        dispatch({ type: 'SET_SHARE_SETTINGS', payload: nextSettings });
        return;
      }
      setBackendBusy(true);
      setBackendError(null);
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
      try {
        const write = await persistShareSettings(nextSettings);
        dispatch({
          type: 'SET_SHARE_SETTINGS',
          payload: nextSettings,
          dirty: write.status === 'queued',
        });
        dispatch({ type: 'SET_SYNC_STATUS', payload: write.status });
        await analytics
          .track({
            name: 'cp_share_setting_update',
            params: {
              enabled_count: Object.values(nextSettings).filter(Boolean).length,
            },
          })
          .catch(() => undefined);
      } catch (error) {
        dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
        reportBackendError(error);
      } finally {
        setBackendBusy(false);
      }
    },
    [
      backendBusy,
      analytics,
      persistShareSettings,
      reportBackendError,
      state.paired,
      state.shareSettings,
      state.sharingCompleted,
      state.sharingPairId,
    ],
  );
  const useRecommendedSharing = useCallback(() => {
    if (!state.paired || !state.sharingPairId) return;
    const recommended: Record<ShareField, boolean> = {
      cyclePhase: true,
      cycleStatus: true,
      fertilityStatus: true,
      predictedPeriod: true,
      periodDates: false,
      mood: true,
      symptoms: false,
      energy: false,
      condition: true,
      carePreference: true,
      note: false,
    };
    dispatch({ type: 'USE_RECOMMENDED_SHARING' });
    if (state.sharingCompleted) {
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
      persistShareSettings(recommended).then(
        write => {
          dispatch({
            type: 'SET_SHARE_SETTINGS',
            payload: recommended,
            dirty: write.status === 'queued',
          });
          dispatch({ type: 'SET_SYNC_STATUS', payload: write.status });
        },
        error => {
          dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
          reportBackendError(error);
        },
      );
    }
  }, [
    persistShareSettings,
    reportBackendError,
    state.paired,
    state.sharingCompleted,
    state.sharingPairId,
  ]);
  const completeSharing = useCallback(async () => {
    if (!state.paired || !state.sharingPairId || state.stage !== 'sharing')
      return;
    setBackendBusy(true);
    setBackendError(null);
    dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
    try {
      const write = await persistShareSettings(state.shareSettings);
      dispatch({
        type: 'COMPLETE_SHARING',
        queued: write.status === 'queued',
      });
      dispatch({ type: 'SET_SYNC_STATUS', payload: write.status });
      await analytics
        .track({
          name: 'cp_share_setting_update',
          params: {
            enabled_count: Object.values(state.shareSettings).filter(Boolean)
              .length,
          },
        })
        .catch(() => undefined);
    } catch (error) {
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
      reportBackendError(error);
    } finally {
      setBackendBusy(false);
    }
  }, [
    persistShareSettings,
    analytics,
    reportBackendError,
    state.paired,
    state.shareSettings,
    state.sharingPairId,
    state.stage,
  ]);
  const setTab = useCallback(
    (payload: MainTab) => {
      dispatch({ type: 'SET_TAB', payload });
      if (payload === 'partner') {
        analytics.track({ name: 'cp_partner_open' }).catch(() => undefined);
      }
    },
    [analytics],
  );
  const saveCheckIn = useCallback(
    async (payload: DailyCheckIn) => {
      if (
        !backendSession ||
        !hasCurrentSensitiveHealthConsent(
          state.sensitiveDataConsentAcceptedAt,
          state.sensitiveDataConsentVersion,
        )
      ) {
        reportBackendError(
          new Error('current sensitive health consent unavailable'),
        );
        return false;
      }
      const checkIn = state.isLogger
        ? payload
        : {
            ...payload,
            periodStarted: false,
            periodEnded: false,
          };
      const localDate = toDeviceLocalDate();
      const nextSeed = checkIn.periodStarted
        ? {
            ...state.seed,
            lastPeriodStart: localDate,
            lastPeriodEnd: undefined,
            averageCycleLength: observedAverageCycleLength(
              { seed: state.seed, dailyHistory: state.dailyHistory },
              localDate,
            ),
          }
        : checkIn.periodEnded
        ? { ...state.seed, lastPeriodEnd: localDate }
        : state.seed;
      const mutationId = createMutationId('daily');
      setBackendBusy(true);
      setBackendError(null);
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
      try {
        const write = await backend.saveDailyLog(
          backendSession.uid,
          localDate,
          toPrivateDailyLogRecord(checkIn),
          mutationId,
        );
        dispatch({ type: 'SAVE_CHECK_IN', payload: checkIn });
        dispatch({
          type: 'SET_SYNC_STATUS',
          payload: write.status === 'queued' ? 'queued' : 'synced',
        });
        await analytics
          .track({
            name: 'cp_cycle_log',
            params: { sync_state: write.status },
          })
          .catch(() => undefined);
        if (write.status === 'synced' && state.isLogger && state.hasCycleSeed) {
          if (
            !hasCurrentSensitiveHealthConsent(
              state.sensitiveDataConsentAcceptedAt,
              state.sensitiveDataConsentVersion,
            )
          ) {
            throw new Error('sensitive data consent unavailable');
          }
          await backend.savePrivateSetup(
            backendSession.uid,
            true,
            state.sensitiveDataConsentAcceptedAt!,
            state.sensitiveDataConsentVersion!,
            toPrivateCycleRecord(nextSeed),
          );
          lastCyclePersistenceKey.current = cyclePersistenceKey(
            backendSession.uid,
            localDate,
            state.sensitiveDataConsentAcceptedAt!,
            nextSeed,
          );
        }
        return true;
      } catch (error) {
        dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
        reportBackendError(error);
        return false;
      } finally {
        setBackendBusy(false);
      }
    },
    [
      backend,
      backendSession,
      analytics,
      reportBackendError,
      state.dailyHistory,
      state.hasCycleSeed,
      state.isLogger,
      state.seed,
      state.sensitiveDataConsentAcceptedAt,
      state.sensitiveDataConsentVersion,
    ],
  );
  const deleteDailyLog = useCallback(
    async (localDate: string) => {
      // Deletion is always available to the authenticated owner. The current
      // consent gate applies to creating or updating health data, not erasure.
      if (!backendSession) {
        reportBackendError(new Error('backend session unavailable'));
        return false;
      }
      const mutationId = createMutationId('daily-delete');
      setBackendBusy(true);
      setBackendError(null);
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
      try {
        const write = await backend.deleteDailyLog(
          backendSession.uid,
          localDate,
          mutationId,
        );
        dispatch({ type: 'DELETE_DAILY_LOG', payload: localDate });
        dispatch({
          type: 'SET_SYNC_STATUS',
          payload: write.status === 'queued' ? 'queued' : 'synced',
        });
        return true;
      } catch (error) {
        dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
        reportBackendError(error);
        return false;
      } finally {
        setBackendBusy(false);
      }
    },
    [backend, backendSession, reportBackendError],
  );
  const upsertPairEvent = useCallback(
    async (event: PairEventInput) => {
      const pairId = activePair?.pairId ?? state.sharingPairId;
      if (!backendSession || !pairId || !state.paired) return false;
      const mutationId = createMutationId('event');
      const now = new Date().toISOString();
      const existing = state.sharedEvents.find(item => item.id === event.id);
      setBackendBusy(true);
      setBackendError(null);
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
      try {
        const write = await backend.upsertPairEvent(
          backendSession.uid,
          pairId,
          event,
          mutationId,
        );
        const optimistic: PairEvent = {
          ...event,
          pairId,
          createdBy: existing?.createdBy ?? backendSession.uid,
          updatedBy: backendSession.uid,
          mutationId,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        dispatch({
          type: 'SET_PAIR_EVENTS',
          payload: [
            optimistic,
            ...state.sharedEvents.filter(item => item.id !== event.id),
          ].sort((left, right) =>
            left.date === right.date
              ? (left.startTime ?? '').localeCompare(right.startTime ?? '')
              : left.date.localeCompare(right.date),
          ),
        });
        dispatch({
          type: 'SET_SYNC_STATUS',
          payload: write.status === 'queued' ? 'queued' : 'synced',
        });
        return true;
      } catch (error) {
        dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
        reportBackendError(error);
        return false;
      } finally {
        setBackendBusy(false);
      }
    },
    [
      activePair?.pairId,
      backend,
      backendSession,
      reportBackendError,
      state.paired,
      state.sharedEvents,
      state.sharingPairId,
    ],
  );
  const deletePairEvent = useCallback(
    async (eventId: string) => {
      const pairId = activePair?.pairId ?? state.sharingPairId;
      if (!backendSession || !pairId || !state.paired) return false;
      const mutationId = createMutationId('event-delete');
      setBackendBusy(true);
      setBackendError(null);
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
      try {
        const write = await backend.deletePairEvent(
          backendSession.uid,
          pairId,
          eventId,
          mutationId,
        );
        dispatch({
          type: 'SET_PAIR_EVENTS',
          payload: state.sharedEvents.filter(item => item.id !== eventId),
        });
        dispatch({
          type: 'SET_SYNC_STATUS',
          payload: write.status === 'queued' ? 'queued' : 'synced',
        });
        return true;
      } catch (error) {
        dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
        reportBackendError(error);
        return false;
      } finally {
        setBackendBusy(false);
      }
    },
    [
      activePair?.pairId,
      backend,
      backendSession,
      reportBackendError,
      state.paired,
      state.sharedEvents,
      state.sharingPairId,
    ],
  );
  const sendPartnerNudge = useCallback(
    async (type: PartnerNudgeType) => {
      const pairId = activePair?.pairId ?? state.sharingPairId;
      if (!backendSession || !pairId || !state.paired || nudgeBusy) {
        return false;
      }
      const requestId = createMutationId('nudge');
      setNudgeBusy(true);
      setNudgeFeedback(null);
      try {
        const result = await backend.sendPartnerNudge(
          backendSession.uid,
          pairId,
          type,
          requestId,
        );
        setPartnerNudgeState(current => ({
          ...current,
          nextAllowedAt: {
            ...current.nextAllowedAt,
            [type]: result.nextAllowedAt,
          },
        }));
        setNudgeFeedback('파트너에게 넛지를 남겼어요.');
        return true;
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code)
            : '';
        const retryAt = partnerNudgeRetryAt(error);
        if (retryAt) {
          setPartnerNudgeState(current => ({
            ...current,
            nextAllowedAt: {
              ...current.nextAllowedAt,
              [type]: retryAt,
            },
          }));
        }
        const retryMinutes = retryAt
          ? Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 60_000))
          : 30;
        setNudgeFeedback(
          code.includes('resource-exhausted')
            ? `같은 넛지는 ${retryMinutes}분 뒤에 다시 보낼 수 있어요.`
            : code.includes('network') || code.includes('unavailable')
            ? '인터넷에 연결한 뒤 넛지를 다시 보내 주세요.'
            : '넛지를 남기지 못했어요. 잠시 뒤 다시 시도해 주세요.',
        );
        reportFailure(error, 'pair', 'send-nudge', false);
        return false;
      } finally {
        setNudgeBusy(false);
      }
    },
    [
      activePair?.pairId,
      backend,
      backendSession,
      nudgeBusy,
      reportFailure,
      state.paired,
      state.sharingPairId,
    ],
  );
  const acknowledgePartnerNudge = useCallback(async () => {
    const pairId = activePair?.pairId ?? state.sharingPairId;
    const received = partnerNudgeState.received;
    if (!pairId || !received || nudgeBusy) return false;
    setNudgeBusy(true);
    setNudgeFeedback(null);
    try {
      await backend.acknowledgePartnerNudge(pairId, received.requestId);
      setPartnerNudgeState(current => ({ ...current, received: null }));
      return true;
    } catch (error) {
      setNudgeFeedback('인터넷에 연결한 뒤 다시 확인해 주세요.');
      reportFailure(error, 'pair', 'acknowledge-nudge', false);
      return false;
    } finally {
      setNudgeBusy(false);
    }
  }, [
    activePair?.pairId,
    backend,
    nudgeBusy,
    partnerNudgeState.received,
    reportFailure,
    state.sharingPairId,
  ]);
  useEffect(() => {
    if (!backendSession) return;
    let active = true;
    const stop = addNetworkListener(network => {
      if (
        network.isConnected !== true ||
        network.isInternetReachable === false
      ) {
        return;
      }
      dispatch({ type: 'SET_SYNC_STATUS', payload: 'syncing' });
      (async () => {
        const report = await backend.flushPendingMutations(backendSession.uid);
        if (!active) return;
        const startupHistoryLoad = initialDailyHistoryLoad.current;
        let dailyHistory: readonly DailyHistoryEntry[];
        if (report.flushed === 0 && startupHistoryLoad) {
          await startupHistoryLoad;
          if (!active) return;
          dailyHistory = latestState.current.dailyHistory;
        } else {
          const dailyLogs = await backend.syncDailyLogs(backendSession.uid);
          if (!active) return;
          dailyHistory = dailyLogs.map(fromPrivateDailyLogSnapshot);
          dispatch({
            type: 'RESTORE_DAILY_HISTORY',
            payload: dailyHistory,
          });
        }
        const currentState = latestState.current;
        const restoredSeed = seedFromDailyHistory(
          currentState.seed,
          dailyHistory,
        );
        if (
          report.flushed > 0 &&
          report.remaining === 0 &&
          currentState.isLogger &&
          currentState.hasCycleSeed &&
          hasCurrentSensitiveHealthConsent(
            currentState.sensitiveDataConsentAcceptedAt!,
            currentState.sensitiveDataConsentVersion,
          )
        ) {
          await backend.savePrivateSetup(
            backendSession.uid,
            true,
            currentState.sensitiveDataConsentAcceptedAt!,
            currentState.sensitiveDataConsentVersion!,
            toPrivateCycleRecord(restoredSeed),
          );
          lastCyclePersistenceKey.current = cyclePersistenceKey(
            backendSession.uid,
            currentState.currentLocalDate,
            currentState.sensitiveDataConsentAcceptedAt!,
            restoredSeed,
          );
        }
        if (
          report.remaining === 0 &&
          currentState.sharingCompleted &&
          currentState.shareSettingsDirty
        ) {
          dispatch({
            type: 'SET_SHARE_SETTINGS',
            payload: currentState.shareSettings,
            dirty: false,
          });
        }
        dispatch({
          type: 'SET_SYNC_STATUS',
          payload:
            report.failed > 0
              ? 'error'
              : report.remaining > 0
              ? 'queued'
              : 'synced',
        });
      })().catch(error => {
        if (!active) return;
        dispatch({ type: 'SET_SYNC_STATUS', payload: 'error' });
        reportBackendError(error);
      });
    });
    return () => {
      active = false;
      stop();
    };
  }, [backend, backendSession, reportBackendError]);
  const toggleNotifications = useCallback(async () => {
    setBackendError(null);
    if (!state.neutralNotifications) {
      dispatch({ type: 'SET_NOTIFICATIONS_ENABLED', payload: true });
      return;
    }

    setNotificationBusy(true);
    try {
      await notificationClient.disable();
      dispatch({ type: 'SET_NOTIFICATIONS_ENABLED', payload: false });
    } catch (error) {
      // deleteLocalToken is still attempted by NotificationClient even when
      // the server unregister call fails, so the local preference can safely
      // remain disabled while invalid-token cleanup handles the server record.
      dispatch({ type: 'SET_NOTIFICATIONS_ENABLED', payload: false });
      reportFailure(error, 'notification', 'unregister-device', true);
    } finally {
      setNotificationBusy(false);
    }
  }, [notificationClient, reportFailure, state.neutralNotifications]);
  const updateNotificationQuietHours = useCallback(
    async (start: string, end: string) => {
      if (!LOCAL_TIME.test(start) || !LOCAL_TIME.test(end) || start === end) {
        setBackendError(
          '조용한 시간은 서로 다른 HH:mm 형식으로 입력해 주세요.',
        );
        return false;
      }
      setBackendError(null);
      dispatch({
        type: 'SET_NOTIFICATION_QUIET_HOURS',
        payload: { start, end },
      });
      return true;
    },
    [],
  );
  const toggleDiagnostics = useCallback(async () => {
    const enabled = !state.diagnosticsEnabled;
    setDiagnosticsBusy(true);
    setBackendError(null);
    try {
      await Promise.all([
        analytics.setEnabled(enabled),
        crashReporter.setEnabled(enabled),
      ]);
      dispatch({ type: 'SET_DIAGNOSTICS_ENABLED', payload: enabled });
    } catch (error) {
      reportFailure(error, 'startup', 'configure-diagnostics', false);
    } finally {
      setDiagnosticsBusy(false);
    }
  }, [analytics, crashReporter, reportFailure, state.diagnosticsEnabled]);
  const disconnectPair = useCallback(async () => {
    if (!activePair || backend.kind === 'preview') {
      activePairRef.current = null;
      setActivePair(null);
      dispatch({ type: 'DISCONNECT_PAIR' });
      return;
    }
    setBackendBusy(true);
    setBackendError(null);
    try {
      await backend.revokePair(activePair.pairId);
      if (backendSession) {
        await backend.clearPendingPairMutations(
          backendSession.uid,
          activePair.pairId,
        );
      }
      activePairRef.current = null;
      setActivePair(null);
      dispatch({ type: 'DISCONNECT_PAIR' });
    } catch (error) {
      reportBackendError(error);
    } finally {
      setBackendBusy(false);
    }
  }, [activePair, backend, backendSession, reportBackendError]);
  const resetApp = useCallback(() => {
    if (backend.kind !== 'preview') return;
    storage.clear().catch(() => undefined);
    dispatch({ type: 'RESET' });
  }, [backend.kind, storage]);

  const value = useMemo<CyclePairContextValue>(
    () => ({
      state,
      isHydrating: localHydrating || backendHydrating,
      backendKind: backend.kind,
      backendSession,
      activePair,
      invite,
      backendBusy,
      notificationBusy,
      diagnosticsBusy,
      backendError,
      inAppNotices,
      toastNotice,
      partnerNudgeState,
      nudgeBusy,
      nudgeFeedback,
      clearBackendError: () => setBackendError(null),
      dismissToastNotice,
      openInAppNotice,
      completeOnboarding,
      goBack,
      openPairing,
      continueToSharing,
      completeSetup,
      updatePrivateSetup,
      createInvite,
      acceptInvite,
      previewLinkPartner,
      toggleShare,
      useRecommendedSharing,
      completeSharing,
      setTab,
      saveCheckIn,
      deleteDailyLog,
      upsertPairEvent,
      deletePairEvent,
      sendPartnerNudge,
      acknowledgePartnerNudge,
      toggleNotifications,
      updateNotificationQuietHours,
      toggleDiagnostics,
      disconnectPair,
      resetApp,
    }),
    [
      state,
      localHydrating,
      backendHydrating,
      backend.kind,
      backendSession,
      activePair,
      invite,
      backendBusy,
      notificationBusy,
      diagnosticsBusy,
      backendError,
      inAppNotices,
      toastNotice,
      partnerNudgeState,
      nudgeBusy,
      nudgeFeedback,
      dismissToastNotice,
      openInAppNotice,
      completeOnboarding,
      goBack,
      openPairing,
      continueToSharing,
      completeSetup,
      updatePrivateSetup,
      createInvite,
      acceptInvite,
      previewLinkPartner,
      toggleShare,
      useRecommendedSharing,
      completeSharing,
      setTab,
      saveCheckIn,
      deleteDailyLog,
      upsertPairEvent,
      deletePairEvent,
      sendPartnerNudge,
      acknowledgePartnerNudge,
      toggleNotifications,
      updateNotificationQuietHours,
      toggleDiagnostics,
      disconnectPair,
      resetApp,
    ],
  );

  return (
    <CyclePairContext.Provider value={value}>
      {children}
    </CyclePairContext.Provider>
  );
}

export function useCyclePair(): CyclePairContextValue {
  const context = useContext(CyclePairContext);
  if (!context)
    throw new Error('useCyclePair must be used inside CyclePairProvider');
  return context;
}
