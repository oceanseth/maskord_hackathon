import { useState } from 'react';
import { useAuth } from '@maskord/shared';
import { useAppStore } from '../../store/app';
import SettingsModal from './SettingsModal';

interface Props { userId: string; }

export default function UserPanel({ userId: _userId }: Props) {
  const { profile, logOut } = useAuth();
  const { activeGuildId, activeChannelId, activeChannelType } = useAppStore();
  const isInVoice = activeChannelType === 'voice' && !!activeChannelId && !!activeGuildId;
  const [showSettings, setShowSettings] = useState(false);

  if (!profile) return null;

  const initials = profile.displayName.substring(0, 2).toUpperCase();

  return (
    <div className="h-14 bg-[#0a0a12] border-t border-[#1e1e2e] flex items-center gap-2 px-3">
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center overflow-hidden">
          {profile.avatarUrl
            ? <img src={profile.avatarUrl} alt={profile.displayName} className="w-full h-full object-cover" />
            : <span className="text-xs font-bold text-white">{initials}</span>
          }
        </div>
        {/* Status dot */}
        <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-[#0a0a12]" />
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{profile.displayName}</p>
        <p className="text-[10px] text-[#6b7280] truncate">
          {isInVoice ? '🔊 In Voice' : 'Online'}
        </p>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* Controls */}
      <div className="flex items-center gap-1">
        <IconButton title="Settings" onClick={() => setShowSettings(true)}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        </IconButton>
        <IconButton title="Sign Out" onClick={logOut}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="w-8 h-8 rounded flex items-center justify-center text-[#6b7280] hover:text-white hover:bg-[#1e1e2e] transition-colors"
    >
      <div className="w-4 h-4">{children}</div>
    </button>
  );
}
