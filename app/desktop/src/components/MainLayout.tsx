import { useEffect, useState } from 'react';
import { useGuildChannels, normalizeChannelMode } from '@maskord/shared';
import type { Channel } from '@maskord/shared';
import { useAppStore } from '../store/app';
import { useIsMobile } from '../hooks/useIsMobile';
import GuildSidebar from './guild/GuildSidebar';
import ChannelSidebar from './channel/ChannelSidebar';
import HomePanel from './home/HomePanel';
import HomeDashboard from './home/HomeDashboard';
import TextChannel from './channel/TextChannel';
import ChannelGameView from './channel/ChannelGameView';
import VoiceChannel from './voice/VoiceChannel';
import { VoiceProvider } from './voice/VoiceProvider';
import DmPanel from './voice/DmPanel';
import WelcomePanel from './ui/WelcomePanel';

export default function MainLayout() {
  const {
    activeView,
    activeGuildId,
    activeChannelId,
    activeChannelType,
    activeDmPartnerId,
  } = useAppStore();

  const isMobile = useIsMobile();

  // The mode is read from the channel itself rather than carried in the store:
  // it can change while the channel is open, and the store's active-channel
  // tuple is set from eight call sites that have no reason to learn about modes.
  const channels = useGuildChannels(activeGuildId ?? null);
  const mode = normalizeChannelMode(channels.find((c: Channel) => c.id === activeChannelId)?.mode);
  // Voice counts too: `setVoiceChannel` joins the call from the sidebar, and
  // what the main pane draws is independent of it — so a voice game channel
  // keeps its audio and shows the table instead of a grid of avatars.
  const isGameChannel = mode !== 'default' && (activeChannelType === 'text' || activeChannelType === 'voice');

  // On mobile we render either the sidebars OR the active content pane, never
  // both — otherwise three flex columns get crushed into ~50px each.
  const contentActive = !!activeDmPartnerId
    || (activeView === 'guild' && !!activeGuildId && !!activeChannelId);
  // Collapsing is a desktop affordance: on mobile the sidebars already give way
  // to the content pane, and a second mechanism would fight the first.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('maskord.sidebars.collapsed') === '1',
  );
  useEffect(() => {
    localStorage.setItem('maskord.sidebars.collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  const hidden = collapsed && !isMobile;
  const showSidebars = !isMobile || !contentActive;
  const showContent  = !isMobile || contentActive;

  return (
    <VoiceProvider>
      {/* h-screen (100vh) is taller than the visible area on mobile browsers, which
          pushes bottom bars (e.g. voice controls) under the address/nav chrome.
          100dvh tracks the actual visible viewport; h-screen is the fallback. */}
      <div className="relative flex h-screen [height:100dvh] overflow-hidden bg-[#0a0a0f]">
        {showSidebars && (
          // Slid out rather than unmounted: a collapsed ChannelSidebar keeps its
          // voice connection and its scroll position, and coming back is
          // instant instead of a remount.
          <div
            className={`flex min-h-0 transition-[margin] duration-200 ease-out ${
              hidden ? '-ml-[312px]' : 'ml-0'
            }`}
            aria-hidden={hidden}
          >
            {/* Guild list — leftmost narrow column */}
            <GuildSidebar />

            {/* Column 2 — HomePanel or ChannelSidebar */}
            {activeView === 'guild' && activeGuildId
              ? <ChannelSidebar guildId={activeGuildId} />
              : <HomePanel />
            }
          </div>
        )}

        {/* A gutter the handle owns. Without it the arrow is painted over the
            channel header's first glyph — it still takes the click, but it
            reads as a smudge on the icon. A column rather than padding on the
            content pane, so the header keeps its full-width bottom border. */}
        {hidden && <div className="w-8 flex-shrink-0" />}

        {/* The handle. Sits above everything so it stays reachable once the
            columns it hides have slid away — otherwise collapsing is one-way.
            Expanded, it lands in the guild rail's traffic-light spacer
            (h-[46px]), which is why it clears the home button. */}
        {!isMobile && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={hidden ? 'Show servers and channels' : 'Hide servers and channels'}
            aria-label={hidden ? 'Show servers and channels' : 'Hide servers and channels'}
            className={`absolute top-1.5 z-40 w-6 h-6 rounded-md flex items-center justify-center text-[#6b7280] hover:text-white hover:bg-[#1e1e2e] transition-all duration-200 no-drag ${
              hidden ? 'left-1.5' : 'left-[22px]'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d={hidden ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
            </svg>
          </button>
        )}

        {/* Main content panel */}
        {showContent && (
          <div className="flex-1 flex flex-col min-w-0">
            {activeDmPartnerId && (
              <DmPanel partnerUid={activeDmPartnerId} />
            )}
            {!activeDmPartnerId && activeView === 'home' && !isMobile && (
              <HomeDashboard />
            )}
            {!activeDmPartnerId && activeView === 'guild' && activeGuildId && activeChannelType === 'text' && activeChannelId && !isGameChannel && (
              <TextChannel guildId={activeGuildId} channelId={activeChannelId} />
            )}
            {!activeDmPartnerId && activeView === 'guild' && activeGuildId && activeChannelId && isGameChannel && (
              <ChannelGameView guildId={activeGuildId} channelId={activeChannelId} mode={mode} />
            )}
            {!activeDmPartnerId && activeView === 'guild' && activeGuildId && activeChannelType === 'voice' && activeChannelId && !isGameChannel && (
              <VoiceChannel guildId={activeGuildId} channelId={activeChannelId} />
            )}
            {!activeDmPartnerId && activeView === 'guild' && activeGuildId && !activeChannelId && !isMobile && (
              <WelcomePanel />
            )}
          </div>
        )}
      </div>
    </VoiceProvider>
  );
}
