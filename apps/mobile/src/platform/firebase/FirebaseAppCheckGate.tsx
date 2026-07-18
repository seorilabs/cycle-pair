import React, {type PropsWithChildren, useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {initializeFirebaseAppCheck} from './FirebaseAppCheckBootstrap';

type BootstrapState = 'pending' | 'ready' | 'failed';

export interface FirebaseAppCheckGateProps extends PropsWithChildren {
  readonly initialInitialization: Promise<boolean>;
}

export function FirebaseAppCheckGate({
  children,
  initialInitialization,
}: FirebaseAppCheckGateProps) {
  const [state, setState] = useState<BootstrapState>('pending');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const initialization = attempt === 0
      ? initialInitialization
      : initializeFirebaseAppCheck().then(
        () => true,
        () => false,
      );
    initialization.then(succeeded => {
      if (active) setState(succeeded ? 'ready' : 'failed');
    });
    return () => {
      active = false;
    };
  }, [attempt, initialInitialization]);

  const retry = () => {
    setState('pending');
    setAttempt(value => value + 1);
  };

  if (state === 'ready') return children;

  return (
    <View style={styles.container} testID="app-check-bootstrap">
      <Text style={styles.title}>Cycle Pair를 안전하게 시작하는 중이에요</Text>
      {state === 'failed' ? (
        <>
          <Text style={styles.body}>
            기기 보안 확인을 완료하지 못했어요. 네트워크 연결을 확인해 주세요.
          </Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
            <Text style={styles.buttonLabel}>다시 시도</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff9f7',
  },
  title: {
    color: '#382d2a',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    marginTop: 12,
    color: '#6f5b55',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  button: {
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: '#854c45',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
