import React from 'react';
import { Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render } from '@testing-library/react-native';
import { createInitialState, useCyclePair } from '../app/CyclePairStore';
import { I18nProvider } from '../i18n/I18nProvider';
import { InviteScreen } from './InviteScreen';

jest.mock('../app/CyclePairStore', () => ({
  ...jest.requireActual('../app/CyclePairStore'),
  useCyclePair: jest.fn(),
}));
const token = 'A'.repeat(40) + '_-z';
beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1', 'en');
  jest.mocked(useCyclePair).mockReturnValue({
    state: createInitialState(),
    backendKind: 'firebase',
    backendSession: { uid: 'invite-test' },
    invite: {
      inviteToken: token,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  } as ReturnType<typeof useCyclePair>);
});
afterEach(() => jest.restoreAllMocks());
it('shares only the invitation code', async () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.sharedAction });
  const view = await render(
    <I18nProvider>
      <InviteScreen
        draft={{ direction: 'send', code: '' }}
        onDraftChange={jest.fn()}
        onBack={jest.fn()}
      />
    </I18nProvider>,
  );
  await fireEvent.press(view.getByText('Share invitation'));
  expect(share).toHaveBeenCalledWith(
    expect.objectContaining({ message: token }),
  );
});
it('keeps the code when a complete invitation message is pasted', async () => {
  const onDraftChange = jest.fn();
  const view = await render(
    <I18nProvider>
      <InviteScreen
        draft={{ direction: 'receive', code: '' }}
        onDraftChange={onDraftChange}
        onBack={jest.fn()}
      />
    </I18nProvider>,
  );
  const input = view.getByTestId('invite-input');
  expect(input.props.maxLength).not.toBe(43);
  await fireEvent.changeText(
    input,
    `Enter this code in Cycle Pair before Nov 2, 9:00 PM:\n${token}`,
  );
  expect(onDraftChange).toHaveBeenLastCalledWith({
    direction: 'receive',
    code: token,
  });
});
