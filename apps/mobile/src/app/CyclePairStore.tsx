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
import {
  asyncStorageCyclePairStateStorage,
  type CyclePairStateStorage,
} from '../platform/local/CyclePairStateStorage';
import type {
  ActivePairMembership,
  BackendKind,
  BackendSession,
  CyclePairBackend,
  PairInvite,
  RemotePartnerProjection,
} from '../platform/backend/CyclePairBackend';
import {
  fromBackendShareSettings,
  toBackendShareSettings,
  toPrivateCycleRecord,
  toPrivateDailyLogRecord,
} from '../platform/backend/backendPayloads';
import { previewCyclePairBackend } from '../platform/backend/PreviewCyclePairBackend';

export type AppStage = 'onboarding' | 'setup' | 'invite' | 'sharing' | 'main';
export type MainTab = 'home' | 'calendar' | 'partner' | 'settings';
export type ShareField =
  | 'cyclePhase'
  | 'predictedPeriod'
  | 'periodDates'
  | 'mood'
  | 'symptoms'
  | 'carePreference';

export interface CycleSeed {
  lastPeriodStart: string;
  averageCycleLength: number;
  averagePeriodLength: number;
}

export interface DailyCheckIn {
  mood?: '힘들어요' | '지쳐요' | '괜찮아요' | '좋아요';
  symptoms: string[];
  carePreference?: '쉬고 싶어요' | '따뜻하게 챙겨줘요' | '그냥 들어줘요' | '평소처럼 대해줘요';
  periodStarted: boolean;
}

export interface CyclePairState {
  schemaVersion: 3;
  stage: AppStage;
  activeTab: MainTab;
  isLogger: boolean;
  seed: CycleSeed;
  paired: boolean;
  sharingCompleted: boolean;
  sharingPairId?: string;
  partnerName: string;
  partnerProjection?: RemotePartnerProjection;
  shareSettings: Record<ShareField, boolean>;
  shareSettingsDirty: boolean;
  checkIn: DailyCheckIn;
  neutralNotifications: boolean;
  sensitiveDataConsentAcceptedAt?: string;
  lastSavedAt?: string;
}

interface PersistedShellPreferences {
  readonly schemaVersion: 3;
  readonly onboardingComplete: boolean;
  readonly neutralNotifications: boolean;
}

export type CyclePairAction =
  | { type: 'RESTORE_SHELL_PREFERENCES'; payload: PersistedShellPreferences }
  | {
      type: 'RESTORE_PRIVATE_SETUP';
      payload: { isLogger: boolean; seed?: CycleSeed; consentAcceptedAt: string };
    }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'COMPLETE_SETUP'; payload: { isLogger: boolean; seed: CycleSeed; consentAcceptedAt: string } }
  | { type: 'GO_BACK' }
  | { type: 'OPEN_PAIRING' }
  | { type: 'CONTINUE_TO_SHARING' }
  | { type: 'LINK_PARTNER'; payload: { pairId: string; name?: string } }
  | {
      type: 'RESTORE_SHARE_SETTINGS';
      payload: { pairId: string; settings: Record<ShareField, boolean> | null };
    }
  | { type: 'SET_PARTNER_PROJECTION'; payload?: RemotePartnerProjection }
  | {
      type: 'SET_SHARE_SETTINGS';
      payload: Record<ShareField, boolean>;
      dirty?: boolean;
    }
  | { type: 'USE_RECOMMENDED_SHARING' }
  | { type: 'COMPLETE_SHARING' }
  | { type: 'SET_TAB'; payload: MainTab }
  | { type: 'SAVE_CHECK_IN'; payload: DailyCheckIn }
  | { type: 'TOGGLE_NOTIFICATIONS' }
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

function privateByDefault(): Record<ShareField, boolean> {
  return {
    cyclePhase: false,
    predictedPeriod: false,
    periodDates: false,
    mood: false,
    symptoms: false,
    carePreference: false,
  };
}

export function createInitialState(): CyclePairState {
  return {
    schemaVersion: 3,
    stage: 'onboarding',
    activeTab: 'home',
    isLogger: true,
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
    checkIn: {
      symptoms: [],
      periodStarted: false,
    },
    neutralNotifications: true,
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
        stage: state.sensitiveDataConsentAcceptedAt
          ? state.stage
          : restored.onboardingComplete
            ? 'setup'
            : 'onboarding',
        neutralNotifications: restored.neutralNotifications,
      };
    }
    case 'RESTORE_PRIVATE_SETUP':
      return {
        ...state,
        isLogger: action.payload.isLogger,
        ...(action.payload.seed ? { seed: action.payload.seed } : {}),
        sensitiveDataConsentAcceptedAt: action.payload.consentAcceptedAt,
        stage: state.paired
          ? state.sharingCompleted
            ? 'main'
            : 'sharing'
          : 'main',
        activeTab: state.paired ? state.activeTab : 'home',
      };
    case 'COMPLETE_ONBOARDING':
      return { ...state, stage: 'setup' };
    case 'COMPLETE_SETUP':
      return {
        ...state,
        isLogger: action.payload.isLogger,
        seed: action.payload.seed,
        sensitiveDataConsentAcceptedAt: action.payload.consentAcceptedAt,
        stage: state.paired ? (state.sharingCompleted ? 'main' : 'sharing') : 'main',
        activeTab: state.paired ? state.activeTab : 'home',
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
      ) return state;
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
          predictedPeriod: true,
          periodDates: false,
          mood: true,
          symptoms: false,
          carePreference: true,
        },
        shareSettingsDirty: true,
      };
    case 'COMPLETE_SHARING':
      if (state.stage !== 'sharing' || !state.paired || !state.sharingPairId) return state;
      return {
        ...state,
        sharingCompleted: true,
        shareSettingsDirty: false,
        stage: 'main',
        activeTab: 'home',
      };
    case 'SET_TAB':
      return { ...state, activeTab: action.payload };
    case 'SAVE_CHECK_IN':
      return {
        ...state,
        checkIn: action.payload,
        seed: action.payload.periodStarted
          ? { ...state.seed, lastPeriodStart: toLocalDate(new Date()) }
          : state.seed,
        lastSavedAt: new Date().toISOString(),
      };
    case 'TOGGLE_NOTIFICATIONS':
      return { ...state, neutralNotifications: !state.neutralNotifications };
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
        stage: state.sensitiveDataConsentAcceptedAt ? 'main' : 'setup',
        activeTab: state.sensitiveDataConsentAcceptedAt ? 'partner' : state.activeTab,
        partnerProjection: undefined,
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
  if (code.includes('network')) return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
  if (code.includes('resource-exhausted')) return '초대 생성 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.';
  if (code.includes('failed-precondition')) return '초대가 만료됐거나 이미 사용됐습니다.';
  if (code.includes('permission-denied')) return '현재 계정으로 접근할 수 없습니다.';
  if (code.includes('unauthenticated')) return '로그인 상태를 다시 확인해 주세요.';
  return '동기화 중 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.';
}

interface CyclePairContextValue {
  state: CyclePairState;
  isHydrating: boolean;
  backendKind: BackendKind;
  backendSession: BackendSession | null;
  activePair: ActivePairMembership | null;
  invite: PairInvite | null;
  backendBusy: boolean;
  backendError: string | null;
  clearBackendError(): void;
  completeOnboarding(): void;
  goBack(): boolean;
  openPairing(): void;
  continueToSharing(): void;
  completeSetup(payload: {
    isLogger: boolean;
    seed: CycleSeed;
    consentAcceptedAt: string;
  }): Promise<void>;
  createInvite(): Promise<void>;
  acceptInvite(inviteToken: string): Promise<void>;
  previewLinkPartner(): void;
  toggleShare(field: ShareField): Promise<void>;
  useRecommendedSharing(): void;
  completeSharing(): Promise<void>;
  setTab(tab: MainTab): void;
  saveCheckIn(checkIn: DailyCheckIn): Promise<boolean>;
  toggleNotifications(): void;
  disconnectPair(): Promise<void>;
  resetApp(): void;
}

const CyclePairContext = createContext<CyclePairContextValue | null>(null);

export function CyclePairProvider({
  children,
  storage = asyncStorageCyclePairStateStorage,
  backend = previewCyclePairBackend,
}: PropsWithChildren<{
  storage?: CyclePairStateStorage;
  backend?: CyclePairBackend;
}>) {
  const [state, dispatch] = useReducer(reduceCyclePairState, undefined, createInitialState);
  const [localHydrating, setLocalHydrating] = useState(true);
  const [backendHydrating, setBackendHydrating] = useState(true);
  const [backendSession, setBackendSession] = useState<BackendSession | null>(null);
  const [activePair, setActivePair] = useState<ActivePairMembership | null>(null);
  const activePairRef = useRef<ActivePairMembership | null>(null);
  const [invite, setInvite] = useState<PairInvite | null>(null);
  const [backendBusy, setBackendBusy] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const shareWriteChain = useRef<Promise<void>>(Promise.resolve());

  const reportBackendError = useCallback((error: unknown) => {
    setBackendError(backendErrorMessage(error));
  }, []);

  useEffect(() => {
    let active = true;
    storage
      .read()
      .then(value => {
        if (!active || !value) return;
        const persisted = JSON.parse(value) as {
          schemaVersion?: 2 | 3;
          onboardingComplete?: unknown;
          neutralNotifications?: unknown;
        };
        if (
          persisted.schemaVersion !== 2 &&
          persisted.schemaVersion !== 3
        ) return;
        dispatch({
          type: 'RESTORE_SHELL_PREFERENCES',
          payload: {
            schemaVersion: 3,
            onboardingComplete: persisted.onboardingComplete === true,
            neutralNotifications: persisted.neutralNotifications !== false,
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
        const setup = await backend.loadPrivateSetup(session.uid);
        if (!active) return;
        if (setup) {
          dispatch({
            type: 'RESTORE_PRIVATE_SETUP',
            payload: {
              isLogger: setup.recordsCycle,
              consentAcceptedAt: setup.consentAcceptedAt,
              ...(setup.cycle
                ? {
                    seed: {
                      lastPeriodStart: setup.cycle.periodDates.startDate,
                      averageCycleLength: setup.cycle.averageCycleLength,
                      averagePeriodLength: setup.cycle.averagePeriodLength,
                    },
                  }
                : {}),
            },
          });
        }
        setBackendSession(session);
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
        setActivePair(membership);
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
          const currentPair = activePairRef.current;
          if (!currentPair || currentPair.pairId === tombstone.pairId) {
            activePairRef.current = null;
            setActivePair(null);
            dispatch({ type: 'DISCONNECT_PAIR' });
          }
          backend.acknowledgeCacheTombstone(tombstone.id).catch(reportBackendError);
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
    if (!activePair || !backendSession) return;
    const stopProjection = backend.watchPartnerProjection(
      activePair,
      projection =>
        dispatch({
          type: 'SET_PARTNER_PROJECTION',
          ...(projection ? { payload: projection } : {}),
        }),
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
    return () => {
      stopProjection();
      stopSettings();
    };
  }, [activePair, backend, backendSession, reportBackendError]);

  useEffect(() => {
    if (localHydrating) return;
    const preferences: PersistedShellPreferences = {
      schemaVersion: 3,
      onboardingComplete: state.stage !== 'onboarding',
      neutralNotifications: state.neutralNotifications,
    };
    storage.write(JSON.stringify(preferences)).catch(reportBackendError);
  }, [
    localHydrating,
    reportBackendError,
    state.neutralNotifications,
    state.stage,
    storage,
  ]);

  const completeOnboarding = useCallback(
    () => dispatch({ type: 'COMPLETE_ONBOARDING' }),
    [],
  );
  const goBack = useCallback(() => {
    if (
      state.stage !== 'setup' &&
      state.stage !== 'invite' &&
      state.stage !== 'sharing'
    ) return false;
    if (backendBusy) return true;
    dispatch({ type: 'GO_BACK' });
    return true;
  }, [backendBusy, state.stage]);
  const openPairing = useCallback(
    () => dispatch({ type: 'OPEN_PAIRING' }),
    [],
  );
  const continueToSharing = useCallback(
    () => dispatch({ type: 'CONTINUE_TO_SHARING' }),
    [],
  );
  const completeSetup = useCallback(
    async (payload: { isLogger: boolean; seed: CycleSeed; consentAcceptedAt: string }) => {
      if (!backendSession) {
        reportBackendError(new Error('backend session unavailable'));
        return;
      }
      setBackendBusy(true);
      setBackendError(null);
      try {
        await backend.savePrivateSetup(
          backendSession.uid,
          payload.isLogger,
          payload.consentAcceptedAt,
          payload.isLogger ? toPrivateCycleRecord(payload.seed) : undefined,
        );
        dispatch({ type: 'COMPLETE_SETUP', payload });
      } catch (error) {
        reportBackendError(error);
      } finally {
        setBackendBusy(false);
      }
    },
    [backend, backendSession, reportBackendError],
  );
  const createInvite = useCallback(async () => {
    setBackendBusy(true);
    setBackendError(null);
    try {
      setInvite(await backend.createPairInvite(state.isLogger));
    } catch (error) {
      reportBackendError(error);
    } finally {
      setBackendBusy(false);
    }
  }, [backend, reportBackendError, state.isLogger]);
  const acceptInvite = useCallback(
    async (inviteToken: string) => {
      setBackendBusy(true);
      setBackendError(null);
      try {
        await backend.acceptPairInvite(inviteToken, state.isLogger);
      } catch (error) {
        reportBackendError(error);
      } finally {
        setBackendBusy(false);
      }
    },
    [backend, reportBackendError, state.isLogger],
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
    (settings: Record<ShareField, boolean>): Promise<void> => {
      if (!backendSession || !state.sharingPairId) return Promise.resolve();
      const write = () =>
        backend.saveShareSettings(
          backendSession.uid,
          state.sharingPairId!,
          toBackendShareSettings(settings),
        );
      const queued = shareWriteChain.current.then(write, write);
      shareWriteChain.current = queued.catch(reportBackendError);
      return queued;
    },
    [backend, backendSession, reportBackendError, state.sharingPairId],
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
      try {
        await persistShareSettings(nextSettings);
        dispatch({
          type: 'SET_SHARE_SETTINGS',
          payload: nextSettings,
          dirty: false,
        });
      } catch (error) {
        reportBackendError(error);
      } finally {
        setBackendBusy(false);
      }
    },
    [
      backendBusy,
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
      predictedPeriod: true,
      periodDates: false,
      mood: true,
      symptoms: false,
      carePreference: true,
    };
    dispatch({ type: 'USE_RECOMMENDED_SHARING' });
    if (state.sharingCompleted) {
      persistShareSettings(recommended).catch(reportBackendError);
    }
  }, [
    persistShareSettings,
    reportBackendError,
    state.paired,
    state.sharingCompleted,
    state.sharingPairId,
  ]);
  const completeSharing = useCallback(async () => {
    if (!state.paired || !state.sharingPairId || state.stage !== 'sharing') return;
    setBackendBusy(true);
    setBackendError(null);
    try {
      await persistShareSettings(state.shareSettings);
      dispatch({ type: 'COMPLETE_SHARING' });
    } catch (error) {
      reportBackendError(error);
    } finally {
      setBackendBusy(false);
    }
  }, [
    persistShareSettings,
    reportBackendError,
    state.paired,
    state.shareSettings,
    state.sharingPairId,
    state.stage,
  ]);
  const setTab = useCallback(
    (payload: MainTab) => dispatch({ type: 'SET_TAB', payload }),
    [],
  );
  const saveCheckIn = useCallback(
    async (payload: DailyCheckIn) => {
      if (!backendSession) {
        reportBackendError(new Error('backend session unavailable'));
        return false;
      }
      const nextSeed = payload.periodStarted
        ? { ...state.seed, lastPeriodStart: toLocalDate(new Date()) }
        : state.seed;
      setBackendBusy(true);
      setBackendError(null);
      try {
        await backend.saveDailyLog(
          backendSession.uid,
          toPrivateDailyLogRecord(payload),
        );
        if (state.isLogger && payload.periodStarted) {
          if (!state.sensitiveDataConsentAcceptedAt) {
            throw new Error('sensitive data consent unavailable');
          }
          await backend.savePrivateSetup(
            backendSession.uid,
            true,
            state.sensitiveDataConsentAcceptedAt,
            toPrivateCycleRecord(nextSeed),
          );
        }
        dispatch({ type: 'SAVE_CHECK_IN', payload });
        return true;
      } catch (error) {
        reportBackendError(error);
        return false;
      } finally {
        setBackendBusy(false);
      }
    },
    [
      backend,
      backendSession,
      reportBackendError,
      state.isLogger,
      state.seed,
      state.sensitiveDataConsentAcceptedAt,
    ],
  );
  const toggleNotifications = useCallback(
    () => dispatch({ type: 'TOGGLE_NOTIFICATIONS' }),
    [],
  );
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
      activePairRef.current = null;
      setActivePair(null);
      dispatch({ type: 'DISCONNECT_PAIR' });
    } catch (error) {
      reportBackendError(error);
    } finally {
      setBackendBusy(false);
    }
  }, [activePair, backend, reportBackendError]);
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
      backendError,
      clearBackendError: () => setBackendError(null),
      completeOnboarding,
      goBack,
      openPairing,
      continueToSharing,
      completeSetup,
      createInvite,
      acceptInvite,
      previewLinkPartner,
      toggleShare,
      useRecommendedSharing,
      completeSharing,
      setTab,
      saveCheckIn,
      toggleNotifications,
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
      backendError,
      completeOnboarding,
      goBack,
      openPairing,
      continueToSharing,
      completeSetup,
      createInvite,
      acceptInvite,
      previewLinkPartner,
      toggleShare,
      useRecommendedSharing,
      completeSharing,
      setTab,
      saveCheckIn,
      toggleNotifications,
      disconnectPair,
      resetApp,
    ],
  );

  return <CyclePairContext.Provider value={value}>{children}</CyclePairContext.Provider>;
}

export function useCyclePair(): CyclePairContextValue {
  const context = useContext(CyclePairContext);
  if (!context) throw new Error('useCyclePair must be used inside CyclePairProvider');
  return context;
}
