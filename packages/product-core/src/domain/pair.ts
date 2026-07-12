import type { LocalDate } from "./local-date.js";
import type { MemberId, Pair, PairId } from "./models.js";

export class PairInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairInvariantError";
  }
}

export interface CreatePairInput {
  readonly id: PairId;
  readonly memberIds: readonly MemberId[];
  readonly createdOn: LocalDate;
}

function assertNonEmptyId(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new PairInvariantError(`${field} must not be empty`);
  }
}

export function createPair(input: CreatePairInput): Pair {
  assertNonEmptyId(input.id, "pair id");
  if (input.memberIds.length !== 2) {
    throw new PairInvariantError("A pair must contain exactly two members");
  }

  const first = input.memberIds[0];
  const second = input.memberIds[1];
  if (first === undefined || second === undefined) {
    throw new PairInvariantError("A pair must contain exactly two members");
  }
  assertNonEmptyId(first, "member id");
  assertNonEmptyId(second, "member id");
  if (first === second) {
    throw new PairInvariantError("A pair must contain two distinct members");
  }

  return Object.freeze({
    id: input.id,
    memberIds: Object.freeze([first, second]) as readonly [MemberId, MemberId],
    createdOn: input.createdOn,
  });
}

export function isPairMember(pair: Pair, memberId: MemberId): boolean {
  return pair.memberIds.includes(memberId);
}

export function otherMemberId(pair: Pair, memberId: MemberId): MemberId {
  if (pair.memberIds[0] === memberId) {
    return pair.memberIds[1];
  }
  if (pair.memberIds[1] === memberId) {
    return pair.memberIds[0];
  }
  throw new PairInvariantError("The requested member does not belong to this pair");
}
