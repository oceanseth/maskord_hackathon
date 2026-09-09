import { useAppStore } from '../store/app';
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

  return (
    <VoiceProvider>
      <div className="flex h-screen overflow-hidden bg-[#0a0a0f]">
        {/* Guild list — leftmost narrow column */}
        <GuildSidebar />

        {/* Column 2 — HomePanel or ChannelSidebar */}
        {activeView === 'guild' && activeGuildId
          ? <ChannelSidebar guildId={activeGuildId} />
          : <HomePanel />
        }

        {/* Main content panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeDmPartnerId && (
            <DmPanel partnerUid={activeDmPartnerId} />
          )}
          {!activeDmPartnerId && activeView === 'home' && (
            <HomeDashboard />
          )}
          {!activeDmPartnerId && activeView === 'guild' && activeGuildId && activeChannelType === 'text' && activeChannelId && (
            <TextChannel guildId={activeGuildId} channelId={activeChannelId} />
          )}
          {!activeDmPartnerId && activeView === 'guild' && activeGuildId && activeChannelType === 'voice' && activeChannelId && (
            <VoiceChannel guildId={activeGuildId} channelId={activeChannelId} />
          )}
          {!activeDmPartnerId && activeView === 'guild' && activeGuildId && !activeChannelId && (
            <WelcomePanel />
          )}
        </div>
      </div>
    </VoiceProvider>
  );
}
