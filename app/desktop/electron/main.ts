import { app, BrowserWindow, ipcMain, shell, nativeTheme, net, session, systemPreferences } from 'electron';
import crypto from 'crypto';
import path from 'path';

const isDev = process.env['NODE_ENV'] !== 'production';
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

nativeTheme.themeSource = 'dark';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Maskord',
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 12, y: 16 },
    frame: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    if (isDev) mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // macOS: request microphone access at launch so the system prompt appears before
  // the user joins a voice channel (avoids a confusing mid-join denial).
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone');
  }

  // Allow the renderer to request microphone / camera access via getUserMedia.
  // Electron's permission type for getUserMedia is 'media'.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// IPC handlers
ipcMain.handle('get-platform', () => process.platform);

ipcMain.handle('set-badge', (_event, count: number) => {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count > 0 ? String(count) : '');
  }
});

// ─── CORS-free fetch for the ElevenLabs lipsync renderer ──────────────────────
//
// The renderer keeps webSecurity on, but the lipsync pipeline has to call the
// ElevenLabs API and download the finished mp4 from their storage bucket —
// neither of which is guaranteed to send CORS headers. Main-process fetch has
// no CORS, so the renderer proxies those requests through here. Allowlisted
// hosts only; bodies travel as base64.

const PROXY_FETCH_HOSTS = new Set([
  'api.elevenlabs.io',       // flows API (create + poll generations)
  'storage.googleapis.com',  // signed content_url of finished generations
  'masky.ai',                // live-media audio chunks
  'ik.imagekit.io',          // avatar portraits
  'firebasestorage.googleapis.com', // avatar portraits (legacy uploads)
]);

interface ProxyFetchRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  bodyBase64?: string;
}

ipcMain.handle('proxy-fetch', async (_event, req: ProxyFetchRequest) => {
  const url = new URL(req.url);
  if (url.protocol !== 'https:' || !PROXY_FETCH_HOSTS.has(url.hostname)) {
    throw new Error(`proxy-fetch: host not allowed: ${url.hostname}`);
  }
  const res = await fetch(req.url, {
    method:  req.method ?? 'GET',
    headers: req.headers,
    body:    req.bodyBase64 ? Buffer.from(req.bodyBase64, 'base64') : undefined,
  });
  const body = Buffer.from(await res.arrayBuffer());
  return {
    status:      res.status,
    contentType: res.headers.get('content-type') ?? '',
    bodyBase64:  body.toString('base64'),
  };
});

// ─── Twitch OAuth ─────────────────────────────────────────────────────────────

const TWITCH_CLIENT_ID  = 'sgb17aslo6gesnetuqfnf6qql6jrae';
const TWITCH_REDIRECT   = 'http://localhost:2468';
const TWITCH_SCOPES     = ['user:read:email'];
const TWITCH_OAUTH_URL  = 'https://us-central1-maskydotnet.cloudfunctions.net/twitchOAuth';

ipcMain.handle('sign-in-with-twitch', () => {
  return new Promise<{ firebaseToken: string; twitchId: string; displayName: string }>((resolve, reject) => {
    const state = crypto.randomUUID();

    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.set('client_id',     TWITCH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri',  TWITCH_REDIRECT);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope',         TWITCH_SCOPES.join(' '));
    authUrl.searchParams.set('state',         state);

    // Isolated session so this interceptor doesn't affect other windows
    const oauthSession = session.fromPartition(`twitch-oauth-${Date.now()}`, { cache: false });

    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    let intentionallyClosed = false;

    // Intercept at the network level — fires before the connection is attempted,
    // so localhost:2468 never gets an ERR_CONNECTION_REFUSED.
    oauthSession.webRequest.onBeforeRequest(
      { urls: [`${TWITCH_REDIRECT}/*`] },
      (details, callback) => {
        callback({ cancel: true }); // stop the request immediately

        const parsed = new URL(details.url);

        if (parsed.searchParams.get('state') !== state) {
          intentionallyClosed = true;
          if (!win.isDestroyed()) win.close();
          settle(() => reject(new Error('OAuth state mismatch — possible CSRF')));
          return;
        }
        const code = parsed.searchParams.get('code');
        if (!code) {
          intentionallyClosed = true;
          if (!win.isDestroyed()) win.close();
          settle(() => reject(new Error(parsed.searchParams.get('error_description') ?? 'No code returned')));
          return;
        }

        net.fetch(TWITCH_OAUTH_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ code, redirectUri: TWITCH_REDIRECT }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`Cloud Function error: ${res.status}`);
            return res.json() as Promise<{ firebaseToken: string; twitchId: string; displayName: string }>;
          })
          .then((data) => {
            intentionallyClosed = true;
            if (!win.isDestroyed()) win.close();
            settle(() => resolve(data));
          })
          .catch((err) => {
            intentionallyClosed = true;
            if (!win.isDestroyed()) win.close();
            settle(() => reject(err));
          });
      },
    );

    const win = new BrowserWindow({
      width: 500,
      height: 720,
      webPreferences: { nodeIntegration: false, contextIsolation: true, session: oauthSession },
    });

    win.loadURL(authUrl.toString());
    // Only reject if the user manually closed the window (not us closing it after success/error)
    win.on('closed', () => { if (!intentionallyClosed) settle(() => reject(new Error('Login window closed'))); });
  });
});
