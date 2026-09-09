import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@maskord/shared';

interface AppState {
  currentUser: User | null;
  activeView: 'home' | 'guild';
  activeGuildId: string | null;
  activeChannelId: string | null;
  activeChannelType: 'text' | 'voice' | null;
  sidebarCollapsed: boolean;
  memberListOpen: boolean;
  activeDmPartnerId: string | null;
  // Voice connection — separate from which channel is "viewed"
  voiceGuildId: string | null;
  voiceChannelId: string | null;
  // Active DM voice call partner (null when not in a DM call)
  dmCallPartnerId: string | null;

  setCurrentUser:       (user: User | null) => void;
  setActiveGuild:       (guildId: string | null) => void;
  setActiveChannel:     (channelId: string | null, type: 'text' | 'voice' | null) => void;
  setVoiceChannel:      (guildId: string | null, channelId: string | null) => void;
  setDmCallPartner:     (uid: string | null) => void;
  toggleSidebar:        () => void;
  toggleMemberList:     () => void;
  openDm:               (partnerId: string) => void;
  closeDm:              () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentUser:         null,
      activeView:          'home',
      activeGuildId:       null,
      activeChannelId:     null,
      activeChannelType:   null,
      sidebarCollapsed:    false,
      memberListOpen:      true,
      activeDmPartnerId:   null,
      voiceGuildId:        null,
      voiceChannelId:      null,
      dmCallPartnerId:     null,

      setCurrentUser:    (user) => set({ currentUser: user }),
      setActiveGuild:    (guildId) => set({
        activeGuildId:     guildId,
        activeChannelId:   null,
        activeChannelType: null,
        activeDmPartnerId: null,
        activeView:        guildId ? 'guild' : 'home',
      }),
      setActiveChannel:  (channelId, type) => set({
        activeChannelId:   channelId,
        activeChannelType: type,
        activeDmPartnerId: null,
        activeView:        'guild',
      }),
      setVoiceChannel:   (guildId, channelId) => set({ voiceGuildId: guildId, voiceChannelId: channelId }),
      setDmCallPartner:  (uid) => set({ dmCallPartnerId: uid }),
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
