import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConvexProvider } from 'convex/react';
import { initFirebase, useAuth } from '@maskord/shared';
import '../index.css';
import App from '../App';
import { convex } from './convex';
import type { RoomIdentity } from './useRoom';

/**
 * A room page is the Maskord client with a room beside it. The client keeps
 * every one of its features (servers, channels, voice, masks); the room is a
 * second column that only appears once the person is signed in. `render`
 * receives the signed-in identity so the room can join as that human.
 */
export function RoomShell({
  render,
  side = 'right',
  width = 'w-[440px]',
  panelClassName = '',
}: {
  render: (identity: RoomIdentity) => ReactNode;
  side?: 'left' | 'right';
  width?: string;
  /** Extra classes on the room column (a theme scope, for instance). */
  panelClassName?: string;
}) {
  const { firebaseUser, profile } = useAuth();
  const identity: RoomIdentity | null =
    firebaseUser && profile
      ? { key: firebaseUser.uid, name: profile.displayName, avatarUrl: profile.avatarUrl }
      : null;

  const panel = identity ? (
    <aside className={`${width} ${panelClassName} shrink-0 border-[#1f1f2e] ${side === 'right' ? 'border-l' : 'border-r'} flex flex-col min-h-0 bg-[#0c0c14]`}>
      {render(identity)}
    </aside>
  ) : null;

  return (
    <div className="flex h-screen [height:100dvh] w-screen overflow-hidden">
      {side === 'left' && panel}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <App />
      </div>
      {side === 'right' && panel}
    </div>
  );
}

/**
 * A page that is only the room — no Maskord client. For second screens
 * (/wizardmap.html, /debatestats.html) that are opened next to the table.
 * Signed-out visitors still see the room; `render` gets null for them.
 */
export function RoomScreen({ render }: { render: (identity: RoomIdentity | null) => ReactNode }) {
  const { firebaseUser, profile, loading } = useAuth();
  const identity: RoomIdentity | null =
    firebaseUser && profile
      ? { key: firebaseUser.uid, name: profile.displayName, avatarUrl: profile.avatarUrl }
      : null;
  if (loading) return null;
  return <div className="h-screen [height:100dvh] w-screen overflow-hidden flex flex-col">{render(identity)}</div>;
}

export function mountRoomPage(node: ReactNode) {
  initFirebase();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ConvexProvider client={convex}>{node}</ConvexProvider>
    </StrictMode>,
  );
}
