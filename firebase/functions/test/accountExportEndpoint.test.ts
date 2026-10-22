import {expect, test} from 'vitest';
import {accountExportEndpoint} from '../src/services/accountExportEndpoint.js';
const production = {projectId: 'cyclepair-test', region: 'asia-northeast3', emulator: false};
test('production always uses HTTPS and ignores untrusted request host', () => {
  expect(accountExportEndpoint({...production, requestHost: 'evil.example'})).toBe('https://asia-northeast3-cyclepair-test.cloudfunctions.net/downloadAccountDataExport');
  for (const configured of ['http://127.0.0.1:5301/export', 'https://user:password@example.org/export', 'https://example.org/export?token=example', 'https://example.org/export#token=example']) {
    expect(() => accountExportEndpoint({...production, configured})).toThrow();
  }
});
test.each(['127.0.0.1:5301', 'localhost:5301', '10.0.2.2:5301'])('owned emulator exports stay within %s', requestHost => {
  expect(accountExportEndpoint({...production, emulator: true, requestHost})).toBe(`http://${requestHost}/cyclepair-test/asia-northeast3/downloadAccountDataExport`);
});
test('emulator mode rejects external hosts and cannot accept production configuration', () => {
  expect(() => accountExportEndpoint({...production, emulator: true, requestHost: 'evil.example'})).toThrow();
  expect(() => accountExportEndpoint({...production, emulator: true, requestHost: 'localhost:5301', configured: 'https://example.org/export'})).toThrow();
});
test('a physical device export accepts only the explicitly selected local interface', () => {
  const environment = {...production, emulator: true, emulatorDeviceHost: '192.168.1.24'};
  expect(accountExportEndpoint({...environment, requestHost: '192.168.1.24:5301'})).toBe('http://192.168.1.24:5301/cyclepair-test/asia-northeast3/downloadAccountDataExport');
  for (const requestHost of ['192.168.1.25:5301', 'evil.example:5301', '192.168.1.24:80', '192.168.1.24:5301@evil.example']) {
    expect(() => accountExportEndpoint({...environment, requestHost})).toThrow();
  }
  expect(() => accountExportEndpoint({...environment, emulatorDeviceHost: 'evil.example', requestHost: 'evil.example:5301'})).toThrow();
});
