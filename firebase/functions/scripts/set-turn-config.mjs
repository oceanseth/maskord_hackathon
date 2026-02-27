#!/usr/bin/env node
// Sets _config/turn in Firestore using the firebase-tools cached OAuth token.
// Run from anywhere: node firebase/functions/scripts/set-turn-config.mjs

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ── Read values ───────────────────────────────────────────────────────────────

const PROJECT_ID = 'maskydotnet';

// Parse turn_password and turn_region from terraform.tfvars
const tfvarsPath = new URL('../../../terraform/terraform.tfvars', import.meta.url).pathname;
const tfvars = readFileSync(tfvarsPath, 'utf8');

function tfvar(name) {
  const m = tfvars.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"`, 'm'));
  if (!m) throw new Error(`${name} not found in terraform.tfvars`);
  return m[1];
}

const TURN_PASSWORD = tfvar('turn_password');
const TURN_REGION   = (() => { try { return tfvar('turn_region'); } catch { return 'ap-southeast-2'; } })();

// Get the TURN server IP from the environment (read from `terraform output turn_server_ip`)
const TURN_IP = process.env.TURN_IP;
if (!TURN_IP) throw new Error('Set TURN_IP env var: TURN_IP=x.x.x.x node set-turn-config.mjs');

// ── Firestore document ────────────────────────────────────────────────────────

const doc = {
  provider: 'static',
  servers: [
    { urls: `stun:${TURN_IP}:3478` },         // coturn in Sydney — lowest latency for AU
    { urls: 'stun:stun.l.google.com:19302' },  // global fallback STUN
    {
      urls: [
        `turn:${TURN_IP}:3478`,
        `turn:${TURN_IP}:3478?transport=tcp`,
      ],
      username:   'maskord',
      credential: TURN_PASSWORD,
    },
  ],
};

// ── Convert to Firestore REST format ─────────────────────────────────────────

function toFirestoreValue(val) {
  if (typeof val === 'string')  return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number')  return { integerValue: String(val) };
  if (Array.isArray(val))       return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (val && typeof val === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(val).map(([k, v]) => [k, toFirestoreValue(v)])) } };
  }
  return { nullValue: null };
}

const firestoreDoc = {
  fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, toFirestoreValue(v)])),
};

// ── Get OAuth token from firebase-tools config ────────────────────────────────

const fbConfig = JSON.parse(readFileSync(join(homedir(), '.config/configstore/firebase-tools.json'), 'utf8'));
let accessToken = fbConfig.tokens?.access_token;

if (!accessToken) throw new Error('No access token found — run: firebase login');

// Check if token is expired and refresh if needed
const expiresAt = fbConfig.tokens?.expires_at;
if (expiresAt && Date.now() > expiresAt - 60_000) {
  console.log('Access token expired, refreshing...');
  const refreshToken = fbConfig.tokens.refresh_token;
  // Firebase CLI uses Google's OAuth2 endpoints with its own client credentials
  const GOOGLE_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const GOOGLE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  accessToken = data.access_token;
  console.log('Token refreshed.');
}

// ── Write the document ────────────────────────────────────────────────────────

const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/_config/turn`;

console.log(`Writing _config/turn to project ${PROJECT_ID}...`);
console.log('TURN IP:', TURN_IP);
console.log('Document:', JSON.stringify(doc, null, 2));

const res = await fetch(url, {
  method: 'PATCH',
  headers: {
    Authorization:  `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(firestoreDoc),
});

const result = await res.json();

if (!res.ok) {
  console.error('Failed:', JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log('\n✓ _config/turn written successfully.');
console.log('\nRemember to add this Firestore security rule to block direct client reads:');
console.log('  match /_config/{doc=**} { allow read, write: if false; }');
