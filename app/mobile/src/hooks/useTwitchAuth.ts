import { useState, useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { signInWithCustomToken } from 'firebase/auth';
import { getFirebaseAuth } from '@maskord/shared';

const TWITCH_CLIENT_ID    = 'sgb17aslo6gesnetuqfnf6qql6jrae';
const TWITCH_REDIRECT_URI = 'https://www.maskord.com/oauth/twitch';
const TWITCH_CF_URL       = 'https://us-central1-maskydotnet.cloudfunctions.net/twitchOAuth';

export function useTwitchAuth() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const reconnect = useCallback(async (): Promise<boolean> => {
    setError(null);
    setLoading(true);
    try {
      const state = Crypto.randomUUID();

      const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
      authUrl.searchParams.set('client_id',     TWITCH_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri',  TWITCH_REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope',         'user:read:email user:write:chat');
      authUrl.searchParams.set('state',         state);

      const result = await WebBrowser.openAuthSessionAsync(
        authUrl.toString(),
        'maskord://',
      );

      if (result.type === 'cancel') return false;
      if (result.type !== 'success' || !result.url) {
        throw new Error('Browser session failed or was dismissed');
      }

      const parsed          = new URL(result.url);
      const returnedState   = parsed.searchParams.get('state');
      const code            = parsed.searchParams.get('code');
      const twitchErrorCode = parsed.searchParams.get('error');
      const twitchErrorDesc = parsed.searchParams.get('error_description');

      if (twitchErrorCode)      throw new Error(twitchErrorDesc ?? twitchErrorCode);
      if (returnedState !== state) throw new Error('OAuth state mismatch — please try again');
      if (!code)                throw new Error('No authorisation code returned by Twitch');

      const res = await fetch(TWITCH_CF_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, redirectUri: TWITCH_REDIRECT_URI }),
      });
      if (!res.ok) throw new Error(`Reconnect failed (${res.status})`);

      const { firebaseToken } = (await res.json()) as { firebaseToken: string };
      await signInWithCustomToken(getFirebaseAuth(), firebaseToken);

      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Twitch reconnect failed');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { reconnect, loading, error, clearError: () => setError(null) };
}
