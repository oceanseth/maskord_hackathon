import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getPlatform:      () => ipcRenderer.invoke('get-platform'),
  setBadge:         (count: number) => ipcRenderer.invoke('set-badge', count),
  signInWithTwitch: () => ipcRenderer.invoke('sign-in-with-twitch'),
  /** CORS-free HTTPS fetch via the main process (allowlisted hosts only).
   *  Used by the ElevenLabs lipsync renderer. */
  proxyFetch: (req: {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    bodyBase64?: string;
  }) => ipcRenderer.invoke('proxy-fetch', req),
});
