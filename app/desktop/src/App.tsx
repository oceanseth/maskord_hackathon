import { useEffect, useRef } from 'react';
import { useAuth, usePresence, joinViaInvite } from '@maskord/shared';
import { useAppStore } from './store/app';
import AuthScreen from './components/auth/AuthScreen';
import MainLayout from './components/MainLayout';
import LoadingScreen from './components/ui/LoadingScreen';

export default function App() {
  const { firebaseUser, profile, loading } = useAuth();
  const { setCurrentUser, setActiveGuild, setActiveChannel, setVoiceChannel } = useAppStore();
  const inviteHandled    = useRef(false);
  const voiceRestored    = useRef(false);

  useEffect(() => {
    setCurrentUser(profile);
  }, [profile, setCurrentUser]);

  // Eagerly stash invite params into sessionStorage as soon as the page loads
  // so they survive any auth redirect (Twitch, Google redirect-mode, etc.).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    const vc     = params.get('vc');
    if (invite) sessionStorage.setItem('pending_invite', invite);
    if (vc)     sessionStorage.setItem('pending_vc',     vc);
  }, []); // intentionally runs once on mount

  // After login, join any pending invite (either from sessionStorage after OAuth
  // redirect, or from the current URL if the user was already logged in).
  useEffect(() => {
    if (!profile || !firebaseUser || inviteHandled.current) return;

    // Read URL params (already-logged-in path) then fall back to sessionStorage
    // (post-OAuth-redirect path, where URL params were stashed before redirect).
    const urlParams = new URLSearchParams(window.location.search);
    const urlInvite = urlParams.get('invite');
    const urlVc     = urlParams.get('vc');
    if (urlInvite) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    const code = urlInvite ?? sessionStorage.getItem('pending_invite');
    const vc   = urlVc   ?? sessionStorage.getItem('pending_vc');
    if (!code) return;

    inviteHandled.current = true;
    sessionStorage.removeItem('pending_invite');
    sessionStorage.removeItem('pending_vc');

    joinViaInvite(code)
      .then(({ guildId }) => {
        setActiveGuild(guildId);
        if (vc) {
          // Show the voice channel in the main panel AND connect to audio.
          // setVoiceChannel triggers VoiceProvider to call getUserMedia + join.
          setActiveChannel(vc, 'voice');
          setVoiceChannel(guildId, vc);
        }
      })
      .catch(console.error);
  }, [profile, firebaseUser, setActiveGuild, setActiveChannel, setVoiceChannel]);

  // Restore voice channel connection after page reload.
  // activeChannelId/Type are persisted to localStorage, but voiceChannelId is not.
  // On reload the UI shows the voice panel but join() was never called — fix that here,
  // once, as soon as auth resolves (same effect as the user clicking the channel).
  useEffect(() => {
    if (!profile || !firebaseUser || voiceRestored.current) return;
    voiceRestored.current = true;

    const { activeChannelType, activeChannelId, activeGuildId, voiceChannelId } =
      useAppStore.getState();

    if (
      activeChannelType === 'voice' &&
      activeChannelId &&
      activeGuildId &&
      !voiceChannelId    // not already joining (e.g. from an invite link)
    ) {
      setVoiceChannel(activeGuildId, activeChannelId);
    }
  }, [profile, firebaseUser, setVoiceChannel]);

  // Register presence
  usePresence(firebaseUser?.uid ?? null);

  if (loading) return <LoadingScreen />;
  if (!firebaseUser || !profile) return <AuthScreen />;

  return <MainLayout />;
}
