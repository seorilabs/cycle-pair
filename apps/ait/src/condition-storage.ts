import { Storage } from '@apps-in-toss/framework';
import type { ConditionShareDraft } from './share-draft';
import {
  clearConditionShareDraftWithStorage,
  getLocalDateKey,
  readConditionShareDraftWithStorage,
  writeConditionShareDraftWithStorage,
} from './condition-storage-core';

export { getLocalDateKey } from './condition-storage-core';

export async function readConditionShareDraft(
  localDate = getLocalDateKey(),
): Promise<ConditionShareDraft> {
  return readConditionShareDraftWithStorage(Storage, localDate);
}

export async function writeConditionShareDraft(
  draft: ConditionShareDraft,
  localDate = getLocalDateKey(),
): Promise<void> {
  return writeConditionShareDraftWithStorage(Storage, draft, localDate);
}

export async function clearConditionShareDraft(): Promise<void> {
  return clearConditionShareDraftWithStorage(Storage);
}
