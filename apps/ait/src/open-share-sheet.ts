import { share } from '@apps-in-toss/framework';

export type ShareSheetOutcome = 'opened' | 'unsupported' | 'failed';

export async function openShareSheet(message: string): Promise<ShareSheetOutcome> {
  if (typeof share !== 'function') return 'unsupported';
  try {
    await share({ message });
    return 'opened';
  } catch {
    return 'failed';
  }
}
