import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@maskord/shared';

interface AppState {
  currentUser: User | null;
  activeGuildId: string | null;
  activeChannelId: string | null;
  activeChannelType: 'text' | 'voice' | null;
  sidebarCollapsed: boolean;
  memberListOpen: boolean;
  activeDmPartnerId: string | null;

  setCurrentUser:       (user: User | null) => void;
  setActiveGuild:       (guildId: string | null) => void;
  setActiveChannel:     (channelId: string | null, type: 'text' | 'voice' | null) => void;
  toggleSidebar:        () => void;
  toggleMemberList:     () => void;
  openDm:               (partnerId: string) => void;
  closeDm:              () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentUser:         null,
      activeGuildId:       null,
      activeChannelId:     null,
      activeChannelType:   null,
      sidebarCollapsed:    false,
      memberListOpen:      true,
      activeDmPartnerId:   null,

      setCurrentUser:   (user) => set({ currentUser: user }),
      setActiveGuild:   (guildId) => set({ activeGuildId: guildId, activeChannelId: null, activeChannelType: null, activeDmPartnerId: null }),
      setActiveChannel: (channelId, type) => set({ activeChannelId: channelId, activeChannelType: type, activeDmPartnerId: null }),
      toggleSidebar:    () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleMemberList: () => set((s) => ({ memberListOpen: !s.memberListOpen })),
      openDm:           (partnerId) => set({ activeDmPartnerId: partnerId }),
      closeDm:          () => set({ activeDmPartnerId: null }),
    }),
    {
      name: 'maskord-app',
      partialize: (s) => ({
        activeGuildId:      s.activeGuildId,
        activeChannelId:    s.activeChannelId,
        activeChannelType:  s.activeChannelType,
        sidebarCollapsed:   s.sidebarCollapsed,
        memberListOpen:     s.memberListOpen,
      }),
    },
  ),
);
