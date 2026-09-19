/**
 * 예측일 리마인더 배달 판정.
 *
 * 실제 발송은 주입받은 `deliver`가 한다. 이 모듈은 누구에게 오늘 보낼지만
 * 정하고, 같은 사용자·같은 배달일에 두 번 보내지 않도록 문서 하나로 막는다.
 */
import {Timestamp} from "firebase-admin/firestore";
import type {
  DocumentData,
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import {
  CYCLE_REMINDER_CONCURRENCY,
  CYCLE_REMINDER_QUERY_LIMIT,
  cycleReminderDeliveryId,
  shouldDeliverCycleReminderOn,
} from "../domain/cycleReminder.js";

type JsonRecord = Record<string, unknown>;

export interface CycleReminderReport {
  readonly pairCandidates: number;
  readonly eligibleRecipients: number;
  readonly delivered: number;
  readonly alreadyDelivered: number;
}

function pairMemberUids(pair: DocumentData | undefined): readonly string[] {
  const members = pair?.members;
  if (
    typeof members !== "object" ||
    members === null ||
    Array.isArray(members)
  ) {
    return [];
  }
  return Object.keys(members as JsonRecord);
}

async function inBoundedChunks<T>(
  items: readonly T[],
  run: (item: T) => Promise<number>,
): Promise<number> {
  let total = 0;
  for (let index = 0; index < items.length; index += CYCLE_REMINDER_CONCURRENCY) {
    const chunk = items.slice(index, index + CYCLE_REMINDER_CONCURRENCY);
    const results = await Promise.all(chunk.map(run));
    total += results.reduce((sum, value) => sum + value, 0);
  }
  return total;
}

/**
 * 배달 기록을 트랜잭션으로 만든다.
 *
 * 이미 있으면 false다. 문서를 먼저 확정한 뒤에 보내므로, 발송이 실패해도 그날
 * 같은 사용자에게 다시 시도하지 않는다. 리마인더는 최선 노력 경로이고,
 * 중복 발송이 미발송보다 나쁘다.
 */
async function claimDelivery(
  db: Firestore,
  recipientUid: string,
  deliverOn: string,
  pairId: string,
): Promise<boolean> {
  const reference = db.doc(
    `users/${recipientUid}/cycleReminderDeliveries/${deliverOn}`,
  );
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) return false;
    transaction.set(reference, {
      schemaVersion: 1,
      deliverOn,
      deliveryId: cycleReminderDeliveryId(pairId, deliverOn),
      createdAt: Timestamp.now(),
    });
    return true;
  });
}

async function remindPair(
  db: Firestore,
  pairSnapshot: QueryDocumentSnapshot<DocumentData>,
  today: string,
  deliver: (recipientUid: string) => Promise<void>,
  counters: {eligible: number; delivered: number; alreadyDelivered: number},
): Promise<number> {
  const pairId = pairSnapshot.id;
  const members = pairMemberUids(pairSnapshot.data());
  if (members.length !== 2) return 0;

  for (const ownerUid of members) {
    const recipientUid = members.find(uid => uid !== ownerUid);
    if (recipientUid === undefined) continue;

    const [privateCycleSnapshot, shareSettingsSnapshot] = await Promise.all([
      db.doc(`users/${ownerUid}/privateCycles/current`).get(),
      db.doc(`users/${ownerUid}/shareSettings/${pairId}`).get(),
    ]);
    const privateCycle = privateCycleSnapshot.data();
    if (privateCycle?.recordsCycle !== true) continue;

    if (
      !shouldDeliverCycleReminderOn({
        privateCycle,
        shareSettings: shareSettingsSnapshot.data(),
        today,
      })
    ) {
      continue;
    }

    counters.eligible += 1;
    if (!(await claimDelivery(db, recipientUid, today, pairId))) {
      counters.alreadyDelivered += 1;
      continue;
    }
    await deliver(recipientUid);
    counters.delivered += 1;
  }
  return 0;
}

export async function deliverPredictedPeriodReminders(
  db: Firestore,
  options: {
    readonly today: string;
    readonly deliver: (recipientUid: string) => Promise<void>;
  },
): Promise<CycleReminderReport> {
  const pairs = await db
    .collection("pairs")
    .where("status", "==", "active")
    .limit(CYCLE_REMINDER_QUERY_LIMIT)
    .get();

  const counters = {eligible: 0, delivered: 0, alreadyDelivered: 0};
  await inBoundedChunks(pairs.docs, snapshot =>
    remindPair(db, snapshot, options.today, options.deliver, counters),
  );

  return {
    pairCandidates: pairs.size,
    eligibleRecipients: counters.eligible,
    delivered: counters.delivered,
    alreadyDelivered: counters.alreadyDelivered,
  };
}
