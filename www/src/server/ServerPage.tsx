import { useEffect, useMemo, useState } from 'react';
import { ConvexProvider } from 'convex/react';
// Imported by module rather than through the package index: the index also
// re-exports the WebRTC voice hook, which is unused here and does not typecheck
// under this workspace's stricter tsconfig.
import { useAuth } from '@maskord/shared/src/hooks/useAuth';
import { useUserGuilds, useGuildChannels } from '@maskord/shared/src/hooks/useGuild';
import ChannelView from '../channel/ChannelView';
import { convex, getSessionId } from '../channel/session';
import SignIn from './SignIn';

/**
 * A signed-in user's own Maskord server, using the production Firebase auth
 * pool. Firebase supplies identity and the guild/channel list; the channel
 * itself — history, presence, dropped files — is held in Convex.
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
      <SignIn
        error={error}
        onSignIn={signIn}
        onGoogle={signInWithGoogle}
        onRegister={register}
      />
    );
  }

  const author = profile?.displayName || firebaseUser.displayName || firebaseUser.email || 'member';

  return (
    <SignedIn
      userId={firebaseUser.uid}
      author={author}
      sessionId={sessionId}
      onSignOut={logOut}
    />
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
  const { guilds, loading } = useUserGuilds(userId);
  const [guildId, setGuildId] = useState<string | null>(null);

  const activeGuildId = guildId ?? guilds[0]?.id ?? null;
  const channels = useGuildChannels(activeGuildId);
  const [channelId, setChannelId] = useState<string | null>(null);

  const textChannels = channels.filter((c) => c.type === 'text');
  const activeChannelId = channelId ?? textChannels[0]?.id ?? null;

  if (loading) return <Splash>Loading your servers…</Splash>;

  if (guilds.length === 0) {
    return (
      <Splash>
        <p className="text-maskord-text font-display font-bold text-xl mb-2">
          You are not in any servers yet
        </p>
        <p className="text-maskord-subtle mb-6">
          Join or create one in the Maskord app, then come back here.
        </p>
        <a
          href="/channel"
          className="px-5 py-3 rounded-xl bg-maskord-accent hover:bg-violet-500 text-white font-medium transition-colors"
        >
          Try the public channel instead
        </a>
      </Splash>
    );
  }

  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const activeChannel = textChannels.find((c) => c.id === activeChannelId);

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
            {guilds.map((g) => (
              <SidebarButton
                key={g.id}
                active={g.id === activeGuildId}
                onClick={() => {
                  setGuildId(g.id);
                  setChannelId(null);
                }}
              >
                {g.name}
              </SidebarButton>
            ))}
          </Section>

          {activeGuild && (
            <Section label={`#${activeGuild.name} channels`}>
              {textChannels.length === 0 && (
                <p className="px-3 text-xs text-maskord-muted">No text channels</p>
              )}
              {textChannels.map((c) => (
                <SidebarButton
                  key={c.id}
                  active={c.id === activeChannelId}
                  onClick={() => setChannelId(c.id)}
                >
                  # {c.name}
                </SidebarButton>
              ))}
            </Section>
          )}
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

      {activeGuildId && activeChannelId ? (
        <ChannelView
          // Scoping the Convex channel by guild and channel keeps every server
          // separate while Firebase still owns membership.
          channelKey={`${activeGuildId}:${activeChannelId}`}
          author={author}
          sessionId={sessionId}
          title={
            <>
              <span className="font-display font-bold text-lg">{activeGuild?.name}</span>
              <span className="ml-3 font-mono text-xs text-maskord-muted">
                #{activeChannel?.name}
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
        <Splash>Pick a channel to start.</Splash>
      )}
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
