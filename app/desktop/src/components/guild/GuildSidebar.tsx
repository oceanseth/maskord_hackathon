import { useAuth, useUserGuilds, createGuild } from '@maskord/shared';
import { useAppStore } from '../../store/app';

export default function GuildSidebar() {
  const { firebaseUser } = useAuth();
  const { guilds } = useUserGuilds(firebaseUser?.uid ?? null);
  const { activeGuildId, setActiveGuild } = useAppStore();

  async function handleCreateGuild() {
    const name = prompt('Server name:');
    if (!name || !firebaseUser) return;
    const guildId = await createGuild(firebaseUser.uid, name);
    setActiveGuild(guildId);
  }

  return (
    <div className="w-[72px] flex-shrink-0 bg-[#06060a] border-r border-[#1e1e2e] flex flex-col items-center py-3 gap-2 overflow-y-auto scrollable">
      {/* Home button */}
      <GuildButton
        active={!activeGuildId}
        onClick={() => setActiveGuild(null)}
        label="Home"
        isHome
      />

      <div className="w-8 h-px bg-[#1e1e2e] my-1" />

      {/* Guild list */}
      {guilds.map((guild) => (
        <GuildButton
          key={guild.id}
          active={activeGuildId === guild.id}
          onClick={() => setActiveGuild(guild.id)}
          label={guild.name}
          iconUrl={guild.iconUrl}
          name={guild.name}
        />
      ))}

      {/* Create guild button */}
      <GuildButton
        isCreate
        onClick={handleCreateGuild}
        label="Create Server"
      />
    </div>
  );
}

interface GuildButtonProps {
  active?: boolean;
  onClick: () => void;
  label: string;
  iconUrl?: string;
  name?: string;
  isHome?: boolean;
  isCreate?: boolean;
}

function GuildButton({ active, onClick, label, iconUrl, name, isHome, isCreate }: GuildButtonProps) {
  return (
    <div className="relative group" title={label}>
      {/* Active indicator pill */}
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1 h-8 bg-white rounded-r-full" />
      )}

      <button
        onClick={onClick}
        className={`
          w-12 h-12 rounded-[24px] group-hover:rounded-[16px] transition-all duration-200
          flex items-center justify-center overflow-hidden
          ${active
            ? 'rounded-[16px] bg-violet-600'
            : 'bg-[#12121a] hover:bg-violet-600'
          }
        `}
      >
        {isHome && (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
          </svg>
        )}
        {isCreate && (
          <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? 'white' : '#4ade80'}>
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
        )}
        {iconUrl && !isHome && !isCreate && (
          <img src={iconUrl} alt={name} className="w-full h-full object-cover" />
        )}
        {!iconUrl && !isHome && !isCreate && name && (
          <span className="text-white font-semibold text-sm">
            {name.substring(0, 2).toUpperCase()}
          </span>
        )}
      </button>
    </div>
  );
}
