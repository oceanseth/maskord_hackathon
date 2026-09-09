import { useEffect, useMemo, useState } from 'react';
import { ConvexProvider, useMutation, useQuery } from 'convex/react';
// Imported by module rather than through the package index: the index also
// re-exports the WebRTC voice hook, which is unused here and does not typecheck
// under this workspace's stricter tsconfig.
import { useAuth } from '@maskord/shared/src/hooks/useAuth';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import ChannelView from '../channel/ChannelView';
import { convex, getSessionId } from '../channel/session';
import SignIn from './SignIn';

/**
 * A signed-in user's own Maskord server, using the production Firebase auth
 * pool. Firebase supplies identity; the servers, their channels, and everything
 * in them — history, presence, dropped files — live in Convex.
 */
export default function ServerPage() {
  return (
    <ConvexProvider client={convex}>
      <Server />
    </ConvexProvider>
  );
}

function Server() {
  const { firebaseUser, profile, loading, error, signIn, signInWithGoogle, register, logOut } =
    useAuth();
  const sessionId = useMemo(getSessionId, []);

  useEffect(() => {
    document.title = 'Maskord — your server';
  }, []);

  if (loading && !firebaseUser) return <Splash>Signing you in…</Splash>;

  if (!firebaseUser) {
    return (
      <SignIn error={error} onSignIn={signIn} onGoogle={signInWithGoogle} onRegister={register} />
    );
  }

  const author =
    profile?.displayName || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'member';

  return (
    <SignedIn userId={firebaseUser.uid} author={author} sessionId={sessionId} onSignOut={logOut} />
  );
}

function SignedIn({
  userId,
  author,
  sessionId,
  onSignOut,
}: {
  userId: string;
  author: string;
  sessionId: string;
  onSignOut: () => void;
}) {
  const servers = useQuery(api.servers.listMine, { ownerId: userId });
  const createServer = useMutation(api.servers.create);
  const addChannel = useMutation(api.servers.addChannel);

  const [serverId, setServerId] = useState<Id<'servers'> | null>(null);
  const [channelId, setChannelId] = useState<Id<'serverChannels'> | null>(null);
  const [busy, setBusy] = useState(false);

  if (servers === undefined) return <Splash>Loading your servers…</Splash>;

  if (servers.length === 0) {
    return (
      <Onboarding
        author={author}
        busy={busy}
        onCreate={async (name) => {
          setBusy(true);
          try {
            const id = await createServer({ ownerId: userId, ownerName: author, name });
            setServerId(id);
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  const activeServer = servers.find((s) => s._id === serverId) ?? servers[0];
  const activeChannel =
    activeServer.channels.find((c) => c._id === channelId) ?? activeServer.channels[0];

  return (
    <div className="h-screen flex bg-maskord-dark text-maskord-text overflow-hidden">
      <nav className="hidden md:flex w-64 shrink-0 flex-col border-r border-maskord-border bg-maskord-darker">
        <div className="h-16 px-5 flex items-center border-b border-maskord-border">
          <a href="/" className="font-display font-bold hover:text-violet-300 transition-colors">
            Maskord
          </a>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-6">
          <Section label="Your servers">
            {servers.map((s) => (
              <SidebarButton
                key={s._id}
                active={s._id === activeServer._id}
                onClick={() => {
                  setServerId(s._id);
                  setChannelId(null);
                }}
              >
                {s.name}
              </SidebarButton>
            ))}
            <button
              onClick={async () => {
                const name = window.prompt('Server name', `${author}'s server`)?.trim();
                if (!name) return;
                const id = await createServer({ ownerId: userId, ownerName: author, name });
                setServerId(id);
                setChannelId(null);
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-maskord-muted hover:bg-maskord-surface/60 transition-colors"
            >
              + New server
            </button>
          </Section>

          <Section label="Channels">
            {activeServer.channels.map((c) => (
              <SidebarButton
                key={c._id}
                active={c._id === activeChannel?._id}
                onClick={() => setChannelId(c._id)}
              >
                # {c.name}
              </SidebarButton>
            ))}
            <button
              onClick={async () => {
                const name = window.prompt('Channel name')?.trim();
                if (!name) return;
                try {
                  await addChannel({ serverId: activeServer._id, name });
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : 'Could not add channel');
                }
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-maskord-muted hover:bg-maskord-surface/60 transition-colors"
            >
              + New channel
            </button>
          </Section>
        </div>

        <div className="p-3 border-t border-maskord-border">
          <div className="px-3 py-2 text-sm truncate">{author}</div>
          <button
            onClick={onSignOut}
            className="w-full px-3 py-2 rounded-lg border border-maskord-border hover:border-violet-700/60 text-xs font-mono transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      {activeChannel ? (
        <ChannelView
          channelKey={`srv:${activeServer._id}:${activeChannel._id}`}
          author={author}
          sessionId={sessionId}
          title={
            <>
              <span className="font-display font-bold text-lg">{activeServer.name}</span>
              <span className="ml-3 font-mono text-xs text-maskord-muted">
                #{activeChannel.name}
              </span>
            </>
          }
          right={
            <button
              onClick={onSignOut}
              className="md:hidden px-3 py-1.5 rounded-lg border border-maskord-border text-xs font-mono"
            >
              Sign out
            </button>
          }
        />
      ) : (
        <Splash>This server has no channels yet.</Splash>
      )}
    </div>
  );
}

function Onboarding({
  author,
  busy,
  onCreate,
}: {
  author: string;
  busy: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(`${author}'s server`);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-maskord-dark text-maskord-text">
      <div className="w-full max-w-md text-center">
        <h1 className="font-display font-bold text-3xl mb-3">
          Let's set up <span className="text-gradient">your server</span>
        </h1>
        <p className="text-maskord-subtle mb-8">
          It starts with #general and #files. Drop images, video or documents into either and
          everyone in the room sees them instantly.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate(name);
          }}
          className="space-y-3"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-maskord-surface border border-maskord-border focus:border-violet-700/60 focus:outline-none text-center"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="w-full px-5 py-3 rounded-xl bg-maskord-accent hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create my server'}
          </button>
        </form>

        <p className="mt-8 text-xs text-maskord-muted">
          Or look around the{' '}
          <a href="/channel" className="text-violet-400 hover:underline">
            public channel
          </a>{' '}
          first.
        </p>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 mb-2 font-mono text-xs tracking-widest uppercase text-maskord-muted">
        {label}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function SidebarButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${
        active
          ? 'bg-maskord-surface text-maskord-text'
          : 'text-maskord-subtle hover:bg-maskord-surface/60'
      }`}
    >
      {children}
    </button>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-screen flex flex-col items-center justify-center px-6 text-center bg-maskord-dark text-maskord-subtle">
      {children}
    </div>
  );
}
