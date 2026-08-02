import {
  EMPTY_SHARE_DRAFT,
  type ConditionShareDraft,
  parseShareDraft,
} from './share-draft';

const STORAGE_KEY = 'cycle-pair/condition-share/v1';
const STORAGE_SCHEMA_VERSION = 1;

interface StoredConditionShareDraft {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly savedLocalDate: string;
  readonly draft: ConditionShareDraft;
}

export interface ConditionStorage {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
  readonly removeItem: (key: string) => Promise<void>;
}

export function getLocalDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseStoredDraft(
  value: unknown,
  expectedLocalDate: string,
): ConditionShareDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<StoredConditionShareDraft>;
  if (
    candidate.schemaVersion !== STORAGE_SCHEMA_VERSION ||
    candidate.savedLocalDate !== expectedLocalDate
  ) {
    return null;
  }
  return parseShareDraft(candidate.draft);
}

export async function readConditionShareDraftWithStorage(
  storage: ConditionStorage,
  localDate: string,
): Promise<ConditionShareDraft> {
  try {
    const value = await storage.getItem(STORAGE_KEY);
    if (!value) return EMPTY_SHARE_DRAFT;
    const draft = parseStoredDraft(JSON.parse(value), localDate);
    if (draft !== null) return draft;
    await storage.removeItem(STORAGE_KEY).catch(() => undefined);
    return EMPTY_SHARE_DRAFT;
  } catch {
    return EMPTY_SHARE_DRAFT;
  }
}

export async function writeConditionShareDraftWithStorage(
  storage: ConditionStorage,
  draft: ConditionShareDraft,
  localDate: string,
): Promise<void> {
  const payload: StoredConditionShareDraft = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    savedLocalDate: localDate,
    draft,
  };
  await storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export async function clearConditionShareDraftWithStorage(
  storage: ConditionStorage,
): Promise<void> {
  await storage.removeItem(STORAGE_KEY);
}
