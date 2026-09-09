import { useState } from 'react';

type Props = {
  error: string | null;
  onSignIn: (email: string, password: string) => Promise<void>;
  onGoogle: () => Promise<void>;
  onRegister: (email: string, password: string, displayName: string) => Promise<void>;
};

/**
 * Sign-in against the production Maskord Firebase project, so an existing
 * masky.ai / Maskord account works here without a separate signup.
 */
export default function SignIn({ error, onSignIn, onGoogle, onRegister }: Props) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signin') await onSignIn(email, password);
      else await onRegister(email, password, displayName || email.split('@')[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-maskord-dark text-maskord-text">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <a href="/" className="font-display font-bold text-2xl hover:text-violet-300 transition-colors">
            Maskord
          </a>
          <p className="text-maskord-subtle text-sm mt-2">
            Sign in with your Maskord account to open your server.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <Field
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              type="text"
              autoComplete="nickname"
            />
          )}
          <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full px-5 py-3 rounded-xl bg-maskord-accent hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-40"
          >
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="flex items-center gap-4 my-5">
          <span className="flex-1 h-px bg-maskord-border" />
          <span className="font-mono text-xs text-maskord-muted">or</span>
          <span className="flex-1 h-px bg-maskord-border" />
        </div>

        <button
          onClick={() => void onGoogle()}
          className="w-full px-5 py-3 rounded-xl border border-maskord-border hover:border-violet-700/60 font-medium transition-colors"
        >
          Continue with Google
        </button>

        <div className="mt-6 text-center text-sm text-maskord-muted">
          {mode === 'signin' ? (
            <>
              No account?{' '}
              <button onClick={() => setMode('register')} className="text-violet-400 hover:underline">
                Create one
              </button>
            </>
          ) : (
            <>
              Already have one?{' '}
              <button onClick={() => setMode('signin')} className="text-violet-400 hover:underline">
                Sign in
              </button>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-maskord-muted">
          Just want to look around?{' '}
          <a href="/channel" className="text-violet-400 hover:underline">
            Open the public channel
          </a>
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-xs tracking-widest uppercase text-maskord-muted mb-1.5">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 rounded-xl bg-maskord-surface border border-maskord-border focus:border-violet-700/60 focus:outline-none"
      />
    </label>
  );
}
