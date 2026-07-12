import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MoonMateProvider } from './src/app/MoonMateStore';
import { MoonMateApp } from './src/MoonMateApp';
import type { MoonMateBackend } from './src/platform/backend/MoonMateBackend';
import { previewMoonMateBackend } from './src/platform/backend/PreviewMoonMateBackend';
import { colors } from './src/theme';

function App({ backend = previewMoonMateBackend }: { backend?: MoonMateBackend }) {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <MoonMateProvider backend={backend}>
        <MoonMateApp />
      </MoonMateProvider>
    </SafeAreaProvider>
  );
}

export default App;
