import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredDisabledDefaults = {
  app_data_collection_default_enabled: false,
  analytics_auto_collection_enabled: false,
  google_analytics_automatic_screen_reporting_enabled: false,
  crashlytics_auto_collection_enabled: false,
  crashlytics_debug_enabled: false,
  crashlytics_ndk_enabled: false,
  messaging_auto_init_enabled: false,
  messaging_ios_auto_register_for_remote_messages: false,
};

const requiredSecurityDefaults = {
  app_check_token_auto_refresh: true,
};

function readConfig(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as {
    readonly ['react-native']: Record<string, unknown>;
  };
}

function readEnvironmentManifest() {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../firebase-environments.json'), 'utf8'),
  ) as {
    readonly schemaVersion: number;
    readonly permanentAppId: string;
    readonly projectId: string;
    readonly androidConfig: string;
    readonly iosConfig: string;
  };
}

describe('RNFirebase native config', () => {
  it('keeps the build-visible mobile config aligned with the root config', () => {
    const rootConfig = readConfig(resolve(__dirname, '../../../firebase.json'));
    const mobileConfig = readConfig(resolve(__dirname, '../firebase.json'));

    expect(mobileConfig['react-native']).toEqual(rootConfig['react-native']);
    expect(mobileConfig['react-native']).toMatchObject(
      requiredDisabledDefaults,
    );
    expect(mobileConfig['react-native']).toMatchObject(
      requiredSecurityDefaults,
    );
    expect(Object.keys(mobileConfig)).toEqual(['react-native']);
  });

  it('keeps permanent app IDs and one Firebase project for every build', () => {
    const environments = readEnvironmentManifest();

    expect(environments).toMatchObject({
      schemaVersion: 2,
      permanentAppId: 'com.seorilabs.cyclepair',
      projectId: 'seorilabs-cyclepair-prod',
      androidConfig: 'android/app/google-services.json',
      iosConfig: 'ios/Firebase/GoogleService-Info.plist',
    });
  });
});
