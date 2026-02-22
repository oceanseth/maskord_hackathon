import { useAppStore } from '../store/app';
import GuildSidebar from './guild/GuildSidebar';
import ChannelSidebar from './channel/ChannelSidebar';
import TextChannel from './channel/TextChannel';
import VoiceChannel from './voice/VoiceChannel';
import WelcomePanel from './ui/WelcomePanel';

export default function MainLayout() {
  const { activeGuildId, activeChannelId, activeChannelType } = useAppStore();

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0f]">
      {/* Guild list — leftmost narrow column */}
      <GuildSidebar />

      {/* Channel list — second column */}
      {activeGuildId && <ChannelSidebar guildId={activeGuildId} />}

      {/* Main content panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeGuildId && <WelcomePanel />}
        {activeGuildId && activeChannelType === 'text' && activeChannelId && (
          <TextChannel guildId={activeGuildId} channelId={activeChannelId} />
        )}
        {activeGuildId && activeChannelType === 'voice' && activeChannelId && (
          <VoiceChannel guildId={activeGuildId} channelId={activeChannelId} />
        )}
        {activeGuildId && !activeChannelId && (
          <WelcomePanel />
        )}
      </div>
    </div>
  );
}
