export type NotificationPermission = 'authorized' | 'denied';
export type NotificationPlatform = 'android' | 'ios';

export interface QuietHours {
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
}

export interface NotificationRegistration {
  readonly token: string;
  readonly platform: NotificationPlatform;
  readonly locale: string;
  readonly quietHours: QuietHours;
}

export interface NeutralNotificationPayload {
  readonly schemaVersion: '1';
  readonly type: 'pair-update' | 'shared-event-update' | 'partner-nudge';
  readonly destination: 'home' | 'calendar';
}

export interface NotificationDelegate {
  requestPermission(): Promise<NotificationPermission>;
  getToken(): Promise<string>;
  register(registration: NotificationRegistration): Promise<void>;
  unregister(token: string): Promise<void>;
  deleteLocalToken(): Promise<void>;
  onTokenRefresh?(listener: (token: string) => void): () => void;
  getInitialOpenedPayload?(): Promise<unknown>;
  onOpenedPayload?(listener: (payload: unknown) => void): () => void;
}

export interface NotificationClient {
  enable(input: {
    readonly platform: NotificationPlatform;
    readonly locale: string;
    readonly quietHours: QuietHours;
  }): Promise<NotificationPermission>;
  disable(): Promise<void>;
  /**
   * Account-bound cleanup. A server unregister failure preserves the local
   * token so the still-authenticated user can retry before Auth sign-out.
   */
  disableForAccountExit(): Promise<void>;
  watchTokenRefresh(
    input: {
      readonly platform: NotificationPlatform;
      readonly locale: string;
      readonly quietHours: QuietHours;
    },
    onError: (error: unknown) => void,
  ): () => void;
  watchOpened(
    onOpen: (payload: NeutralNotificationPayload) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TIME_ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+/-]+)+$/;

export function parseNeutralNotificationPayload(
  value: unknown,
): NeutralNotificationPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).some(
      key => !['schemaVersion', 'type', 'destination'].includes(key),
    ) ||
    payload.schemaVersion !== '1' ||
    (payload.type !== 'pair-update' &&
      payload.type !== 'shared-event-update' &&
      payload.type !== 'partner-nudge') ||
    (payload.destination !== 'home' && payload.destination !== 'calendar')
  ) {
    return null;
  }
  return payload as unknown as NeutralNotificationPayload;
}

function validateQuietHours(value: QuietHours): void {
  if (
    !LOCAL_TIME.test(value.start) ||
    !LOCAL_TIME.test(value.end) ||
    !TIME_ZONE.test(value.timeZone)
  ) {
    throw new Error('Invalid notification quiet hours.');
  }
}

class PrivacySafeNotificationClient implements NotificationClient {
  private registeredToken: string | null = null;
  private knownDisabled = false;
  private registrationEpoch = 0;
  private refreshRegistrationAllowed = false;

  constructor(private readonly delegate: NotificationDelegate) {}

  async enable(input: {
    readonly platform: NotificationPlatform;
    readonly locale: string;
    readonly quietHours: QuietHours;
  }): Promise<NotificationPermission> {
    const registrationEpoch = ++this.registrationEpoch;
    // A stale refresh callback must not register while native permission is
    // being re-evaluated. Successful registration re-opens the fence below.
    this.refreshRegistrationAllowed = false;
    validateQuietHours(input.quietHours);
    const permission = await this.delegate.requestPermission();
    if (permission !== 'authorized') return permission;
    const token = await this.delegate.getToken();
    if (!token) throw new Error('Notification token unavailable.');
    await this.delegate.register({
      token,
      platform: input.platform,
      locale: input.locale.slice(0, 16),
      quietHours: input.quietHours,
    });
    if (registrationEpoch !== this.registrationEpoch) {
      // disable() may have won while register() was in flight. Compensate for
      // the late server write so opt-out cannot be silently reversed.
      await this.delegate.unregister(token).catch(() => undefined);
      return 'denied';
    }
    this.registeredToken = token;
    this.knownDisabled = false;
    this.refreshRegistrationAllowed = true;
    return permission;
  }

  async disable(): Promise<void> {
    ++this.registrationEpoch;
    this.refreshRegistrationAllowed = false;
    if (this.knownDisabled) return;
    const token = this.registeredToken ?? (await this.delegate.getToken());
    let unregisterError: unknown;
    try {
      if (token) await this.delegate.unregister(token);
    } catch (error) {
      unregisterError = error;
    }
    await this.delegate.deleteLocalToken();
    this.registeredToken = null;
    this.knownDisabled = true;
    if (unregisterError) throw unregisterError;
  }

  async disableForAccountExit(): Promise<void> {
    ++this.registrationEpoch;
    this.refreshRegistrationAllowed = false;
    if (this.knownDisabled) return;
    const token = this.registeredToken ?? (await this.delegate.getToken());
    // Do not delete the device token when the authenticated server unregister
    // fails. Keeping both the token and registeredToken makes logout retryable
    // without leaving a deliverable token bound to the previous UID.
    try {
      if (token) await this.delegate.unregister(token);
    } catch (error) {
      // AccountSessionCleanup aborts logout on this error. Re-open refresh for
      // the still-authenticated, still-opted-in session.
      this.refreshRegistrationAllowed = true;
      throw error;
    }
    await this.delegate.deleteLocalToken();
    this.registeredToken = null;
    this.knownDisabled = true;
  }

  watchTokenRefresh(
    input: {
      readonly platform: NotificationPlatform;
      readonly locale: string;
      readonly quietHours: QuietHours;
    },
    onError: (error: unknown) => void,
  ): () => void {
    validateQuietHours(input.quietHours);
    if (!this.delegate.onTokenRefresh) return () => undefined;
    return this.delegate.onTokenRefresh(token => {
      if (!token || !this.refreshRegistrationAllowed) return;
      const registrationEpoch = this.registrationEpoch;
      const previousToken = this.registeredToken;
      this.delegate
        .register({
          token,
          platform: input.platform,
          locale: input.locale.slice(0, 16),
          quietHours: input.quietHours,
        })
        .then(async () => {
          if (
            !this.refreshRegistrationAllowed ||
            registrationEpoch !== this.registrationEpoch
          ) {
            await this.delegate.unregister(token).catch(() => undefined);
            return;
          }
          this.registeredToken = token;
          this.knownDisabled = false;
          if (previousToken && previousToken !== token) {
            await this.delegate
              .unregister(previousToken)
              .catch(() => undefined);
          }
        })
        .catch(onError);
    });
  }

  watchOpened(
    onOpen: (payload: NeutralNotificationPayload) => void,
    onError: (error: unknown) => void,
  ): () => void {
    let active = true;
    const deliver = (value: unknown) => {
      if (!active) return;
      const payload = parseNeutralNotificationPayload(value);
      if (payload) onOpen(payload);
    };
    this.delegate.getInitialOpenedPayload?.().then(deliver).catch(onError);
    const stop = this.delegate.onOpenedPayload?.(deliver) ?? (() => undefined);
    return () => {
      active = false;
      stop();
    };
  }
}

export function createNotificationClient(
  delegate: NotificationDelegate,
): NotificationClient {
  return new PrivacySafeNotificationClient(delegate);
}
