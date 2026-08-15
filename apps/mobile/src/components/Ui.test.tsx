import { render } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { Screen } from './Ui';

describe('Screen keyboard behavior', () => {
  it('lets iOS resize and interactively dismiss around the virtual keyboard', async () => {
    const view = await render(
      <Screen>
        <Text>내용</Text>
      </Screen>,
    );
    const scrollView = view.getByTestId('screen-scroll');

    expect(scrollView.props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(scrollView.props.keyboardDismissMode).toBe('interactive');
    expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
  });
});
