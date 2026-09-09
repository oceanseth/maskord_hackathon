import { useEffect, useMemo, useState } from 'react';
import { ConvexProvider } from 'convex/react';
import ChannelView from './ChannelView';
import { convex, getDisplayName, getSessionId, setDisplayName } from './session';

const CHANNEL = 'hackathon';

/**
 * The public demo channel: no login, a guest name held in localStorage.
 * A signed-in user's own server is at /server.
 */
export default function ChannelPage() {
  const sessionId = useMemo(getSessionId, []);
  const [name, setName] = useState(getDisplayName);

  useEffect(() => {
    document.title = 'Maskord — live channel';
  }, []);

  const renameSelf = () => {
    const next = window.prompt('Display name', name)?.trim();
    if (!next) return;
    setDisplayName(next);
    setName(next);
  };

  return (
    <ConvexProvider client={convex}>
      <div className="min-h-screen flex flex-col bg-maskord-dark text-maskord-text">
        <ChannelView
          channelKey={CHANNEL}
          author={name}
          sessionId={sessionId}
          title={
            <>
              <a
                href="/"
                className="font-display font-bold text-lg hover:text-violet-300 transition-colors"
              >
                Maskord
              </a>
              <span className="ml-3 font-mono text-xs text-maskord-muted">#{CHANNEL}</span>
            </>
          }
          right={
            <>
              <a
                href="/app/index.html"
                className="hidden sm:inline px-3 py-1.5 rounded-lg bg-maskord-accent hover:bg-violet-500 text-white text-xs font-medium transition-colors"
              >
                Open your server
              </a>
              <button
                onClick={renameSelf}
                className="px-3 py-1.5 rounded-lg border border-maskord-border hover:border-violet-700/60 text-xs font-mono transition-colors"
              >
                {name}
              </button>
            </>
          }
        />
      </div>
    </ConvexProvider>
  );
}
