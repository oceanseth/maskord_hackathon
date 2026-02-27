import { useEffect, useMemo } from 'react';
import { useAuth, useUserGuilds, createGuild, useUserProfiles } from '@maskord/shared';
import { useAppStore } from '../../store/app';

export default function GuildSidebar() {
  const { firebaseUser, profile } = useAuth();
  const { guilds, loading: guildsLoading } = useUserGuilds(firebaseUser?.uid ?? null);
  const { activeGuildId, setActiveGuild } = useAppStore();

  // Fetch owner profiles for guilds that don't have a custom icon set,
  // so we can fall back to the owner's avatar (e.g. their Twitch profile pic).
  const ownerIds = useMemo(
    () => guilds.filter((g) => !g.iconUrl).map((g) => g.ownerId),
    [guilds],
  );
  const ownerProfiles = useUserProfiles(ownerIds);

  // Auto-create a personal server if the user has none.
  // Uses localStorage so the guard survives component remounts / re-renders.
  useEffect(() => {
    if (!firebaseUser || !profile || guildsLoading) return;

    const key = `maskord:personal_guild:${firebaseUser.uid}`;

    if (guilds.length > 0) {
      // Already has a guild — record that so we never try to create again.
      localStorage.setItem(key, '1');
      return;
    }

    // No guilds yet. Only create if we haven't already kicked off a creation.
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1'); // set BEFORE the async call to prevent races

    createGuild(firebaseUser.uid, `${profile.displayName}'s server`)
      .then((guildId) => {
        // Only auto-navigate if the user hasn't already been sent somewhere
        // (e.g. via an invite link processed by App.tsx)
        if (!useAppStore.getState().activeGuildId) setActiveGuild(guildId);
      })
      .catch(() => localStorage.removeItem(key)); // allow retry on failure
  }, [firebaseUser, profile, guildsLoading, guilds.length, setActiveGuild]);

  return (
    <div className="w-[72px] flex-shrink-0 bg-[#06060a] border-r border-[#1e1e2e] flex flex-col items-center">
      {/* Drag region + traffic light spacer */}
      <div className="h-[46px] w-full flex-shrink-0 drag-region" />

      {/* Scrollable guild list */}
      <div className="flex-1 flex flex-col items-center pb-3 gap-2 overflow-y-auto scrollable w-full">
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
            iconUrl={guild.iconUrl || ownerProfiles[guild.ownerId]?.avatarUrl}
            name={guild.name}
          />
        ))}
      </div>
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
    <div className="relative group w-full flex justify-center" title={label}>
      {/* Active indicator pill */}
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full" />
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#4ade80">
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
