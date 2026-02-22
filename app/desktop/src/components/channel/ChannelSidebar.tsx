import { useAuth, useGuild, useGuildChannels } from '@maskord/shared';
import type { Channel } from '@maskord/shared';
import { useAppStore } from '../../store/app';
import UserPanel from '../ui/UserPanel';

interface Props { guildId: string; }

export default function ChannelSidebar({ guildId }: Props) {
  const { guild } = useGuild(guildId);
  const channels = useGuildChannels(guildId);
  const { activeChannelId, setActiveChannel } = useAppStore();
  const { firebaseUser } = useAuth();

  const categories = channels.filter((c) => c.type === 'category');
  const uncategorized = channels.filter((c) => c.type !== 'category' && !c.parentId);

  function getChildren(parentId: string) {
    return channels.filter((c) => c.parentId === parentId);
  }

  function handleChannelClick(channel: Channel) {
    const type = channel.type === 'voice' ? 'voice' : 'text';
    setActiveChannel(channel.id, type);
  }

  return (
    <div className="w-60 flex-shrink-0 bg-[#0e0e16] border-r border-[#1e1e2e] flex flex-col">
      {/* Guild header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[#1e1e2e] drag-region">
        <span className="font-semibold text-white text-sm truncate no-drag">
          {guild?.name ?? '...'}
        </span>
        <button className="no-drag text-[#6b7280] hover:text-white transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto scrollable py-2">
        {/* Uncategorized channels */}
        {uncategorized.map((ch) => (
          <ChannelItem
            key={ch.id}
            channel={ch}
            active={activeChannelId === ch.id}
            onClick={() => handleChannelClick(ch)}
          />
        ))}

        {/* Categories + their children */}
        {categories.map((cat) => (
          <div key={cat.id}>
            <div className="flex items-center gap-1 px-4 py-2">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="#6b7280" className="rotate-90">
                <path d="M2 3l3 4 3-4H2z" />
              </svg>
              <span className="text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider">
                {cat.name}
              </span>
              <button className="ml-auto text-[#6b7280] hover:text-white transition-colors opacity-0 group-hover:opacity-100">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </button>
            </div>
            {getChildren(cat.id).map((ch) => (
              <ChannelItem
                key={ch.id}
                channel={ch}
                active={activeChannelId === ch.id}
                onClick={() => handleChannelClick(ch)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* User panel at the bottom */}
      {firebaseUser && <UserPanel userId={firebaseUser.uid} />}
    </div>
  );
}

interface ChannelItemProps {
  channel: Channel;
  active: boolean;
  onClick: () => void;
}

function ChannelItem({ channel, active, onClick }: ChannelItemProps) {
  const isVoice = channel.type === 'voice';

  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-1.5 px-2 mx-2 py-1.5 rounded-md text-sm
        transition-colors group
        ${active
          ? 'bg-[#1e1e2e] text-white'
          : 'text-[#6b7280] hover:bg-[#1e1e2e]/60 hover:text-[#b0b8cc]'
        }
      `}
      style={{ width: 'calc(100% - 16px)' }}
    >
      {isVoice ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 opacity-70">
          <path d="M12 3a9 9 0 0 1 9 9h-2a7 7 0 0 0-7-7V3zm0 4a5 5 0 0 1 5 5h-2a3 3 0 0 0-3-3V7zm-1 5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5zM3 11h2a7 7 0 0 0 7 7v2a9 9 0 0 1-9-9z" />
        </svg>
      ) : (
        <span className="text-base opacity-70 flex-shrink-0 leading-none">#</span>
      )}
      <span className="truncate">{channel.name}</span>
    </button>
  );
}
