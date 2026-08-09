export type BackendKind = 'firebase' | 'preview';

export type BackendConditionCode =
  | 'comfortable'
  | 'tired'
  | 'low-energy'
  | 'needs-space';

export interface BackendSession {
  readonly uid: string;
  readonly isAnonymous: boolean;
}

export interface PairInvite {
  readonly inviteToken: string;
  readonly expiresAt: string;
}

export interface ActivePairMembership {
  readonly pairId: string;
  readonly partnerUid: string;
}

export interface PrivateCycleRecord {
  /** Local calendar date on which cyclePhase and prediction were computed. */
  readonly asOfDate: string;
  readonly averageCycleLength: number;
  readonly averagePeriodLength: number;
  readonly periodDates: {
    readonly startDate: string;
    readonly endDate?: string;
  };
  readonly cyclePhase?: 'menstrual' | 'follicular' | 'luteal' | 'unknown';
  readonly nextPeriodWindow?: {
    readonly startDate: string;
    readonly endDate: string;
  };
}

export interface PrivateSetupSnapshot {
  readonly recordsCycle: boolean;
  readonly consentAcceptedAt: string;
  /** Missing only while reading pre-v2 data that must require re-consent. */
  readonly consentVersion?: string;
  readonly cycle?: PrivateCycleRecord;
}

export interface PrivateDailyLogRecord {
  readonly moodTag?: string;
  readonly symptomTags?: readonly string[];
  readonly energyLevel?: 1 | 2 | 3 | 4 | 5;
  readonly conditionCode?: BackendConditionCode;
  readonly carePreferences?: readonly string[];
  readonly note?: string;
  readonly periodStarted?: boolean;
  readonly periodEnded?: boolean;
}

export interface PrivateDailyLogSnapshot {
  readonly localDate: string;
  readonly record: PrivateDailyLogRecord;
  readonly mutationId?: string;
  readonly updatedAt?: string;
}

export interface PairEventInput {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly note?: string;
}

export interface PairEvent extends PairEventInput {
  readonly pairId: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly mutationId: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export type BackendWriteStatus = 'synced' | 'queued';

export interface BackendWriteResult {
  readonly status: BackendWriteStatus;
  readonly mutationId: string;
}

export interface OfflineSyncReport {
  readonly flushed: number;
  readonly remaining: number;
  /** Non-retryable mutations preserved for explicit recovery or Pair cleanup. */
  readonly failed: number;
}

export interface BackendShareSettings {
  readonly cyclePhase: boolean;
  readonly nextPeriodWindow: boolean;
  readonly periodDates: boolean;
  readonly moodTag: boolean;
  readonly symptomTags: boolean;
  readonly energyLevel: boolean;
  readonly conditionCode: boolean;
  readonly carePreferences: boolean;
  readonly note: boolean;
}

export interface RemotePartnerProjection {
  readonly ownerUid: string;
  readonly pairId: string;
  /** Projection materialization time, not the source record time. */
  readonly generatedAt?: string;
  /** Source LocalDate for cyclePhase/prediction fields. */
  readonly cycleAsOfDate?: string;
  /** Source LocalDate for daily check-in fields. */
  readonly dailyLogDate?: string;
  readonly periodDates?: {
    readonly startDate: string;
    readonly endDate?: string;
  };
  readonly cyclePhase?: 'menstrual' | 'follicular' | 'luteal' | 'unknown';
  readonly nextPeriodWindow?: {
    readonly startDate: string;
    readonly endDate: string;
  };
  readonly symptomTags?: readonly string[];
  readonly moodTag?: string;
  readonly energyLevel?: 1 | 2 | 3 | 4 | 5;
  readonly conditionCode?: BackendConditionCode;
  readonly carePreferences?: readonly string[];
  readonly note?: string;
}

export interface CacheTombstone {
  readonly id: string;
  readonly pairId: string;
}

export type Unsubscribe = () => void;
export type BackendErrorHandler = (error: unknown) => void;

export interface CyclePairBackend {
  readonly kind: BackendKind;
  initialize(): Promise<BackendSession>;
  /** Flush every queued mutation, then stop UID writes without a race window. */
  quiesceSessionForLogout(uid: string): Promise<OfflineSyncReport>;
  /** Stop UID-bound watches/writes and drain local secure-storage writers. */
  quiesceSession(uid: string): Promise<void>;
  /** Re-enable a session only when an account-exit attempt safely rolled back. */
  resumeSession(uid: string): void;
  loadCachedActivePair(uid: string): Promise<ActivePairMembership | null>;
  loadCachedPairEvents(
    uid: string,
    pairId: string,
  ): Promise<readonly PairEvent[]>;
  loadPrivateSetup(uid: string): Promise<PrivateSetupSnapshot | null>;
  savePrivateSetup(
    uid: string,
    recordsCycle: boolean,
    consentAcceptedAt: string,
    consentVersion: string,
    cycle?: PrivateCycleRecord,
  ): Promise<BackendWriteResult>;
  createPairInvite(recordsCycle: boolean): Promise<PairInvite>;
  acceptPairInvite(
    inviteToken: string,
    recordsCycle: boolean,
  ): Promise<{ pairId: string }>;
  listDailyLogs(
    uid: string,
    fromDate: string,
    toDate: string,
  ): Promise<readonly PrivateDailyLogSnapshot[]>;
  saveDailyLog(
    uid: string,
    localDate: string,
    record: PrivateDailyLogRecord,
    mutationId: string,
  ): Promise<BackendWriteResult>;
  deleteDailyLog(
    uid: string,
    localDate: string,
    mutationId: string,
  ): Promise<BackendWriteResult>;
  saveShareSettings(
    uid: string,
    pairId: string,
    settings: BackendShareSettings,
  ): Promise<BackendWriteResult>;
  upsertPairEvent(
    uid: string,
    pairId: string,
    event: PairEventInput,
    mutationId: string,
  ): Promise<BackendWriteResult>;
  deletePairEvent(
    uid: string,
    pairId: string,
    eventId: string,
    mutationId: string,
  ): Promise<BackendWriteResult>;
  flushPendingMutations(uid: string): Promise<OfflineSyncReport>;
  clearPendingPairMutations(uid: string, pairId: string): Promise<void>;
  revokePair(pairId: string): Promise<void>;
  acknowledgeCacheTombstone(tombstoneId: string): Promise<void>;
  watchActivePair(
    uid: string,
    onValue: (membership: ActivePairMembership | null) => void,
    onError: BackendErrorHandler,
  ): Unsubscribe;
  watchPartnerProjection(
    membership: ActivePairMembership,
    onValue: (projection: RemotePartnerProjection | null) => void,
    onError: BackendErrorHandler,
  ): Unsubscribe;
  watchShareSettings(
    uid: string,
    pairId: string,
    onValue: (settings: BackendShareSettings | null) => void,
    onError: BackendErrorHandler,
  ): Unsubscribe;
  watchPairEvents(
    membership: ActivePairMembership,
    onValue: (events: readonly PairEvent[]) => void,
    onError: BackendErrorHandler,
  ): Unsubscribe;
  watchPendingTombstones(
    uid: string,
    onValue: (tombstones: readonly CacheTombstone[]) => void,
    onError: BackendErrorHandler,
  ): Unsubscribe;
}
