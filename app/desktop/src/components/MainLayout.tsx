import { useAuth } from '@maskord/shared';
import { useAppStore } from '../store/app';
import GuildSidebar from './guild/GuildSidebar';
import ChannelSidebar from './channel/ChannelSidebar';
import TextChannel from './channel/TextChannel';
import VoiceChannel from './voice/VoiceChannel';
import { VoiceProvider } from './voice/VoiceProvider';
import DmPanel from './voice/DmPanel';
import WelcomePanel from './ui/WelcomePanel';
import UserPanel from './ui/UserPanel';

export default function MainLayout() {
  const { activeGuildId, activeChannelId, activeChannelType, activeDmPartnerId } = useAppStore();
  const { firebaseUser } = useAuth();

  return (
    <VoiceProvider>
      <div className="flex h-screen overflow-hidden bg-[#0a0a0f]">
        {/* Guild list — leftmost narrow column */}
        <GuildSidebar />

        {/* Channel list — second column (always visible so UserPanel is always shown) */}
        {activeGuildId
          ? <ChannelSidebar guildId={activeGuildId} />
          : (
            <div className="w-60 flex-shrink-0 bg-[#0e0e16] border-r border-[#1e1e2e] flex flex-col">
              <div className="flex-1" />
              {firebaseUser && <UserPanel userId={firebaseUser.uid} />}
            </div>
          )
        }

        {/* Main content panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeDmPartnerId && (
            <DmPanel partnerUid={activeDmPartnerId} />
          )}
          {!activeDmPartnerId && !activeGuildId && <WelcomePanel />}
          {!activeDmPartnerId && activeGuildId && activeChannelType === 'text' && activeChannelId && (
            <TextChannel guildId={activeGuildId} channelId={activeChannelId} />
          )}
          {!activeDmPartnerId && activeGuildId && activeChannelType === 'voice' && activeChannelId && (
            <VoiceChannel guildId={activeGuildId} channelId={activeChannelId} />
          )}
          {!activeDmPartnerId && activeGuildId && !activeChannelId && (
            <WelcomePanel />
          )}
        </div>
      </div>
    </VoiceProvider>
  );
}
