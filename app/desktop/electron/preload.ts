import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getPlatform:      () => ipcRenderer.invoke('get-platform'),
  setBadge:         (count: number) => ipcRenderer.invoke('set-badge', count),
  signInWithTwitch: () => ipcRenderer.invoke('sign-in-with-twitch'),
});
