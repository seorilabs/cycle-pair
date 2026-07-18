import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils.js';

/**
 * Keychain service names can appear in native diagnostics. Dynamic health,
 * account, Pair, and event identifiers therefore use a one-way local alias.
 */
export function opaqueServiceSegment(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value))).slice(0, 32);
}
