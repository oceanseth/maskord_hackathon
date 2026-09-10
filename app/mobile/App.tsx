import { enableScreens } from 'react-native-screens';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { initFirebase } from '@maskord/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getReactNativePersistence } from 'firebase/auth';
import { registerGlobals } from 'react-native-webrtc';
import RootNavigator from './src/navigation/RootNavigator';

enableScreens(true);
// Polyfill RTCPeerConnection, getUserMedia, MediaStream, etc. for React Native.
// Must be called before any voice channel code runs.
registerGlobals();
// firestoreSettings: {} lets the RN Firestore build use its native fetch transport.
// Omitting experimentalForceLongPolling avoids the WebChannelConnection errors
// that occur when the web long-poll transport is forced on React Native.
initFirebase({
  persistence: getReactNativePersistence(AsyncStorage),
  firestoreSettings: {},
});

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer
        theme={{
          ...DarkTheme,
          colors: {
            ...DarkTheme.colors,
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
