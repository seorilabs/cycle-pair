import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CyclePairProvider } from './src/app/CyclePairStore';
import { CyclePairApp } from './src/CyclePairApp';
import type { CyclePairBackend } from './src/platform/backend/CyclePairBackend';
import { previewCyclePairBackend } from './src/platform/backend/PreviewCyclePairBackend';
import { colors } from './src/theme';

function App({ backend = previewCyclePairBackend }: { backend?: CyclePairBackend }) {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <CyclePairProvider backend={backend}>
        <CyclePairApp />
      </CyclePairProvider>
    </SafeAreaProvider>
  );
}

export default App;
