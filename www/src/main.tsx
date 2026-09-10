import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// ─── Twitch mobile OAuth relay ────────────────────────────────────────────────
// Twitch requires HTTPS redirect URIs, so the mobile app uses
// https://www.maskord.com/oauth/twitch as its redirect URI. When Twitch sends
// the user back here with ?code=...&state=..., we deep-link into the app and
// render a status page so the user never sees a blank screen.
if (window.location.pathname === '/oauth/twitch') {
  const qs     = window.location.search;
  const params = new URLSearchParams(qs);
  const code   = params.get('code');
  const error  = params.get('error');
  const errDesc = params.get('error_description');
  const deepLink = 'maskord://oauth' + qs;

  // Attempt the deep-link immediately
  if (code) window.location.replace(deepLink);

  // Render a status page regardless — visible if the OS doesn't intercept the
  // deep-link, or if there was an error from Twitch.
  const root = document.getElementById('root')!;
  root.style.cssText = 'background:#0a0a0f;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';

  if (error) {
    root.innerHTML = `
      <div style="text-align:center;max-width:360px;padding:32px">
        <div style="font-size:40px;margin-bottom:16px">⚠️</div>
        <h2 style="color:#f87171;font-size:18px;font-weight:700;margin:0 0 8px">Twitch sign-in failed</h2>
        <p style="color:#94a3b8;font-size:14px;margin:0 0 24px">${errDesc ?? error}</p>
        <a href="/" style="color:#a78bfa;font-size:14px;text-decoration:none">← Back to Maskord</a>
      </div>`;
  } else if (code) {
    root.innerHTML = `
      <div style="text-align:center;max-width:360px;padding:32px">
        <div style="font-size:40px;margin-bottom:16px">🎭</div>
        <h2 style="color:#ffffff;font-size:18px;font-weight:700;margin:0 0 8px">Opening Maskord…</h2>
        <p style="color:#94a3b8;font-size:14px;margin:0 0 24px">You should be redirected to the app automatically.</p>
        <a href="${deepLink}"
           style="display:inline-block;padding:10px 20px;background:rgba(124,58,237,0.2);border:1px solid rgba(124,58,237,0.4);border-radius:8px;color:#a78bfa;font-size:14px;text-decoration:none;margin-bottom:16px">
          Tap here if the app didn't open
        </a>
        <br/>
        <a href="/" style="color:#6b7280;font-size:12px;text-decoration:none">Back to maskord.com</a>
      </div>`;
  } else {
    root.innerHTML = `
      <div style="text-align:center;max-width:360px;padding:32px">
        <div style="font-size:40px;margin-bottom:16px">❓</div>
        <h2 style="color:#f87171;font-size:18px;font-weight:700;margin:0 0 8px">Missing auth code</h2>
        <p style="color:#94a3b8;font-size:14px;margin:0 0 24px">No authorization code was returned by Twitch. Please try signing in again.</p>
        <a href="/" style="color:#a78bfa;font-size:14px;text-decoration:none">← Back to Maskord</a>
      </div>`;
  }
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
