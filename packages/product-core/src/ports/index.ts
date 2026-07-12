import type { LocalDate } from "../domain/local-date.js";
import type {
  CareTipRule,
  Cycle,
  CycleLog,
  Entitlement,
  Member,
  MemberId,
  NeutralNotificationScheduleItem,
  Pair,
  PairId,
  ShareSettings,
  SubscriptionSnapshot,
} from "../domain/models.js";

export interface ClockPort {
  today(): LocalDate;
}

export interface IdGeneratorPort {
  nextId(): string;
}

export interface AuthPort {
  currentMemberId(): Promise<MemberId | null>;
  getMember(memberId: MemberId): Promise<Member | null>;
}

export interface PairRepositoryPort {
  getById(pairId: PairId): Promise<Pair | null>;
  findByMemberId(memberId: MemberId): Promise<readonly Pair[]>;
  save(pair: Pair): Promise<void>;
  delete(pairId: PairId): Promise<void>;
}

export interface CycleRepositoryPort {
  listCycles(memberId: MemberId): Promise<readonly Cycle[]>;
  saveCycle(cycle: Cycle): Promise<void>;
  listLogs(memberId: MemberId, from: LocalDate, to: LocalDate): Promise<readonly CycleLog[]>;
  saveLog(log: CycleLog): Promise<void>;
}

export interface ShareSettingsRepositoryPort {
  get(memberId: MemberId): Promise<ShareSettings | null>;
  save(settings: ShareSettings): Promise<void>;
}

export interface CareTipRepositoryPort {
  getCatalog(): Promise<readonly CareTipRule[]>;
}

export interface PurchasePort {
  getSubscription(memberId: MemberId): Promise<SubscriptionSnapshot>;
}

export interface EntitlementRepositoryPort {
  get(memberId: MemberId): Promise<Entitlement | null>;
  save(memberId: MemberId, entitlement: Entitlement): Promise<void>;
}

export interface NotificationPort {
  replaceSchedule(
    recipientId: MemberId,
    schedule: readonly NeutralNotificationScheduleItem[],
  ): Promise<void>;
  cancelAll(recipientId: MemberId): Promise<void>;
}
