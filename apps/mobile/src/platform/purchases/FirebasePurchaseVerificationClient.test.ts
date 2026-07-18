/* eslint-env jest */

jest.mock('@react-native-firebase/app', () => ({getApp: jest.fn()}));
jest.mock('@react-native-firebase/auth', () => ({getAuth: jest.fn()}));
jest.mock('@react-native-firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  getFirestore: jest.fn(),
  onSnapshot: jest.fn(),
}));
jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: jest.fn(),
  httpsCallable: jest.fn(),
}));

import {
  parsePurchaseAccountIdentity,
  parsePurchaseVerificationResponse,
  parseSubscriptionSnapshot,
} from './FirebasePurchaseVerificationClient';

const accountToken = '1c51e14d-7ce7-4ec0-88bd-b69850fb8be4';

describe('Firebase purchase response parsers', () => {
  it('accepts the normalized server subscription contract', () => {
    expect(
      parseSubscriptionSnapshot({
        status: 'active',
        provider: 'google-play',
        productId: 'cyclepair_plus',
        basePlanId: 'monthly',
        renewalState: 'will-renew',
        paymentState: 'paid',
        expiresAt: '2026-08-14T10:00:00.000Z',
        verifiedAt: '2026-07-14T10:00:01.000Z',
      }),
    ).toEqual({
      status: 'active',
      provider: 'google-play',
      productId: 'cyclepair_plus',
      basePlanId: 'monthly',
      renewalState: 'will-renew',
      paymentState: 'paid',
      expiresAt: '2026-08-14T10:00:00.000Z',
      verifiedAt: '2026-07-14T10:00:01.000Z',
    });
    expect(parseSubscriptionSnapshot({status: 'none'})).toEqual({
      status: 'none',
    });
  });

  it('rejects malformed status, timestamps, identity, and verification data', () => {
    expect(() => parseSubscriptionSnapshot({status: 'premium'})).toThrow(
      'Invalid subscription response',
    );
    expect(() =>
      parseSubscriptionSnapshot({status: 'active', expiresAt: 'not-a-date'}),
    ).toThrow('Invalid subscription response field: expiresAt');
    expect(() =>
      parsePurchaseAccountIdentity({
        schemaVersion: 1,
        appAccountToken: accountToken,
        googleObfuscatedExternalAccountId:
          '66cc3b75-b016-4992-a08a-a2bd791d2389',
      }),
    ).toThrow('Invalid purchase account identity response');
    expect(() =>
      parsePurchaseVerificationResponse({verified: false, reason: 'pending'}),
    ).toThrow('Invalid purchase verification response');
  });

  it('accepts only a stable matching UUID account binding', () => {
    expect(
      parsePurchaseAccountIdentity({
        schemaVersion: 1,
        appAccountToken: accountToken,
        googleObfuscatedExternalAccountId: accountToken,
      }),
    ).toEqual({
      appAccountToken: accountToken,
      googleObfuscatedExternalAccountId: accountToken,
    });
  });

  it('parses verified and fail-closed server responses', () => {
    expect(
      parsePurchaseVerificationResponse({
        verified: true,
        verificationId: 'verification-1',
        subscription: {
          status: 'expired',
          provider: 'app-store',
          productId: 'com.seorilabs.cyclepair.plus.monthly',
          basePlanId: 'monthly',
          renewalState: 'canceled',
          paymentState: 'expired',
          expiresAt: '2026-07-01T00:00:00.000Z',
          verifiedAt: '2026-07-14T00:00:00.000Z',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        verified: true,
        verificationId: 'verification-1',
        subscription: expect.objectContaining({status: 'expired'}),
      }),
    );
    expect(
      parsePurchaseVerificationResponse({
        verified: false,
        reason: 'account-mismatch',
      }),
    ).toEqual({verified: false, reason: 'account-mismatch'});
  });
});
