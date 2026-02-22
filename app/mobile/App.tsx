import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { initFirebase, useAuth } from '@maskord/shared';
import RootNavigator from './src/navigation/RootNavigator';

// Initialize Firebase on app launch
initFirebase();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer
        theme={{
          dark: true,
          colors: {
            primary: '#7c3aed',
            background: '#0a0a0f',
            card: '#0e0e16',
            text: '#e2e8f0',
            border: '#1e1e2e',
            notification: '#7c3aed',
          },
        }}
      >
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
