import { useState, useEffect } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { useAuth, getFirebaseAuth } from '@maskord/shared';
import { appBaseUrl } from '../../lib/appUrl';

const TWITCH_CLIENT_ID  = 'sgb17aslo6gesnetuqfnf6qql6jrae';
const TWITCH_OAUTH_URL  = 'https://us-central1-maskydotnet.cloudfunctions.net/twitchOAuth';
const isElectron = typeof window !== 'undefined' && 'electron' in window;

// Web redirect URI — Twitch sends the user back here after authorising.
// Must be registered in the Twitch developer console AND allowed by the Cloud
// Function.
const WEB_REDIRECT_URI = appBaseUrl();

type Mode = 'login' | 'register';

export default function AuthScreen() {
  const [mode, setMode]             = useState<Mode>('login');
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [displayName, setDisplayName] = useState('');
  const { signIn, signInWithGoogle, register, loading, error } = useAuth();
  const [twitchError, setTwitchError] = useState<string | null>(null);
  const [twitchLoading, setTwitchLoading] = useState(false);

  // ─── Web OAuth callback handler ────────────────────────────────────────────
  // When Twitch redirects back to maskord.com/app?code=xxx&state=yyy,
  // this effect fires on mount and exchanges the code for a Firebase token.
  useEffect(() => {
    if (isElectron) return;

    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const state  = params.get('state');
    if (!code || !state) return;

    const savedState = sessionStorage.getItem('twitch_oauth_state');
    // Clean the URL immediately so a refresh doesn't re-trigger
    window.history.replaceState({}, '', window.location.pathname);

    if (state !== savedState) {
      setTwitchError('OAuth state mismatch — please try again.');
      return;
    }
    sessionStorage.removeItem('twitch_oauth_state');

    setTwitchLoading(true);
    fetch(TWITCH_OAUTH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code, redirectUri: WEB_REDIRECT_URI }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
        return res.json() as Promise<{ firebaseToken: string }>;
      })
      .then(({ firebaseToken }) => signInWithCustomToken(getFirebaseAuth(), firebaseToken))
      .catch((e: unknown) => setTwitchError(e instanceof Error ? e.message : 'Twitch sign in failed'))
      .finally(() => setTwitchLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Twitch sign-in initiator ──────────────────────────────────────────────

  async function handleTwitchSignIn() {
    setTwitchError(null);

    if (isElectron) {
      // Electron: delegate to the preload IPC handler (opens a popup window)
      try {
        const { firebaseToken } = await (window as unknown as {
          electron: { signInWithTwitch: () => Promise<{ firebaseToken: string }> };
        }).electron.signInWithTwitch();
        await signInWithCustomToken(getFirebaseAuth(), firebaseToken);
      } catch (e: unknown) {
        setTwitchError(e instanceof Error ? e.message : 'Twitch sign in failed');
      }
      return;
    }

    // Web: redirect to Twitch, which redirects back to WEB_REDIRECT_URI?code=...
    const state = crypto.randomUUID();
    sessionStorage.setItem('twitch_oauth_state', state);
    // Preserve invite params — App.tsx also does this on mount, but belt + suspenders
    preserveInviteParams();

    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.set('client_id',     TWITCH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri',  WEB_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope',         'user:read:email');
    authUrl.searchParams.set('state',         state);
    window.location.href = authUrl.toString();
  }

  // Save any invite params before Google redirect (popup keeps URL, redirect loses it)
  function preserveInviteParams() {
    const p = new URLSearchParams(window.location.search);
    const invite = p.get('invite');
    const vc     = p.get('vc');
    if (invite) sessionStorage.setItem('pending_invite', invite);
    if (vc)     sessionStorage.setItem('pending_vc',     vc);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'login') {
      await signIn(email, password);
    } else {
      await register(email, password, displayName);
    }
  }

  const anyLoading = loading || twitchLoading;

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0f] relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-violet-900/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm mx-6">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-700/30 flex items-center justify-center mx-auto mb-4">
            <MaskIcon />
          </div>
          <h1 className="font-display font-bold text-2xl text-white">
            {twitchLoading ? 'Signing in…' : mode === 'login' ? 'Welcome back' : 'Create account'}
          </h1>
          <p className="text-[#6b7280] text-sm mt-1">
            {twitchLoading
              ? 'Exchanging Twitch token…'
              : mode === 'login'
              ? 'Sign in to Maskord'
              : 'Start wearing your masks'}
          </p>
        </div>

        {twitchLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-[#94a3b8] mb-1.5 uppercase tracking-wide">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 rounded-lg bg-[#12121a] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none transition-colors placeholder:text-[#6b7280]"
                    placeholder="Your mask name"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5 uppercase tracking-wide">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-[#12121a] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none transition-colors placeholder:text-[#6b7280]"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5 uppercase tracking-wide">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg bg-[#12121a] border border-[#1e1e2e] focus:border-violet-600 text-white text-sm outline-none transition-colors placeholder:text-[#6b7280]"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={anyLoading}
                className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors mt-1"
              >
                {anyLoading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-[#1e1e2e]" />
              <span className="text-xs text-[#6b7280]">or</span>
              <div className="flex-1 h-px bg-[#1e1e2e]" />
            </div>

            {/* Google sign in */}
            <button
              onClick={() => { preserveInviteParams(); signInWithGoogle(); }}
              disabled={anyLoading}
              className="w-full py-2.5 rounded-lg bg-[#12121a] border border-[#1e1e2e] hover:border-violet-700/50 disabled:opacity-50 text-[#e2e8f0] font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            {/* Twitch sign in */}
            <button
              onClick={handleTwitchSignIn}
              disabled={anyLoading}
              className="w-full mt-2 py-2.5 rounded-lg bg-[#9146ff]/10 border border-[#9146ff]/30 hover:bg-[#9146ff]/20 hover:border-[#9146ff]/60 disabled:opacity-50 text-[#bf94ff] font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              <TwitchIcon />
              Continue with Twitch
            </button>

            {twitchError && (
              <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2 mt-2">
                {twitchError}
              </p>
            )}

            {/* Toggle mode */}
            <p className="text-center text-sm text-[#6b7280] mt-6">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                className="text-violet-400 hover:text-violet-300 font-medium transition-colors"
              >
                {mode === 'login' ? 'Register' : 'Sign In'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function MaskIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path
        d="M3 14C3 8.477 8.373 4 16 4s13 4.477 13 10c0 3.5-2.1 6.6-5.3 8.4l-1.2 4.6c-.2.8-1 1.3-1.8 1H11.3c-.8.3-1.6-.2-1.8-1L8.3 22.4C5.1 20.6 3 17.5 3 14z"
        fill="rgba(124,58,237,0.9)"
      />
      <circle cx="11" cy="13" r="2" fill="white" opacity="0.9" />
      <circle cx="21" cy="13" r="2" fill="white" opacity="0.9" />
    </svg>
  );
}

function TwitchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#9146ff">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
