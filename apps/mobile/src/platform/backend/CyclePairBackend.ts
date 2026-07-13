export type BackendKind = 'firebase' | 'preview';

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
  readonly cycle?: PrivateCycleRecord;
}

export interface PrivateDailyLogRecord {
  readonly moodTag?: string;
  readonly symptomTags?: readonly string[];
  readonly carePreferences?: readonly string[];
}

export interface BackendShareSettings {
  readonly cyclePhase: boolean;
  readonly nextPeriodWindow: boolean;
  readonly periodDates: boolean;
  readonly moodTag: boolean;
  readonly symptomTags: boolean;
  readonly carePreferences: boolean;
}

export interface RemotePartnerProjection {
  readonly ownerUid: string;
  readonly pairId: string;
  readonly generatedAt?: string;
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
  readonly carePreferences?: readonly string[];
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
  loadPrivateSetup(uid: string): Promise<PrivateSetupSnapshot | null>;
  savePrivateSetup(
    uid: string,
    recordsCycle: boolean,
    consentAcceptedAt: string,
    cycle?: PrivateCycleRecord,
  ): Promise<void>;
  createPairInvite(recordsCycle: boolean): Promise<PairInvite>;
  acceptPairInvite(inviteToken: string, recordsCycle: boolean): Promise<{ pairId: string }>;
  saveDailyLog(uid: string, record: PrivateDailyLogRecord): Promise<void>;
  saveShareSettings(uid: string, pairId: string, settings: BackendShareSettings): Promise<void>;
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
  watchPendingTombstones(
    uid: string,
    onValue: (tombstones: readonly CacheTombstone[]) => void,
    onError: BackendErrorHandler,
  ): Unsubscribe;
}
