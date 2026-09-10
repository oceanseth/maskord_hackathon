import { useAppStore } from '../store/app';
import { useIsMobile } from '../hooks/useIsMobile';
import GuildSidebar from './guild/GuildSidebar';
import ChannelSidebar from './channel/ChannelSidebar';
import HomePanel from './home/HomePanel';
import HomeDashboard from './home/HomeDashboard';
import TextChannel from './channel/TextChannel';
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

  // On mobile we render either the sidebars OR the active content pane, never
  // both — otherwise three flex columns get crushed into ~50px each.
  const contentActive = !!activeDmPartnerId
    || (activeView === 'guild' && !!activeGuildId && !!activeChannelId);
  const showSidebars = !isMobile || !contentActive;
  const showContent  = !isMobile || contentActive;

  return (
    <VoiceProvider>
      {/* h-screen (100vh) is taller than the visible area on mobile browsers, which
          pushes bottom bars (e.g. voice controls) under the address/nav chrome.
          100dvh tracks the actual visible viewport; h-screen is the fallback. */}
      <div className="flex h-screen [height:100dvh] overflow-hidden bg-[#0a0a0f]">
        {showSidebars && (
          <>
            {/* Guild list — leftmost narrow column */}
            <GuildSidebar />

            {/* Column 2 — HomePanel or ChannelSidebar */}
            {activeView === 'guild' && activeGuildId
              ? <ChannelSidebar guildId={activeGuildId} />
              : <HomePanel />
            }
          </>
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
            {!activeDmPartnerId && activeView === 'guild' && activeGuildId && activeChannelType === 'text' && activeChannelId && (
              <TextChannel guildId={activeGuildId} channelId={activeChannelId} />
            )}
            {!activeDmPartnerId && activeView === 'guild' && activeGuildId && activeChannelType === 'voice' && activeChannelId && (
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
