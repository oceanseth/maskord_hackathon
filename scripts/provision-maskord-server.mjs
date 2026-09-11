/**
 * Creates the shared "Maskord" server — the one room every account, guest
 * included, is a member of — and records it in `system/maskordDefaults` where
 * the `joinDefaultGuild` callable reads it.
 *
 * Run once per Firebase project. Idempotent: if `system/maskordDefaults`
 * already points at a guild that exists, it prints it and changes nothing.
 *
 *   node scripts/provision-maskord-server.mjs [--owner <uid>] [--name Maskord]
 *
 * Auth: reuses the credentials `firebase login` already stored on this machine
 * (Firestore REST with an OAuth access token), so it needs no service-account
 * key. The writes mirror createGuildFn exactly, plus a permanent invite and
 * `settings.allowGuests: true`.
 */
import { readFileSync } from 'node:fs';

const PROJECT = 'maskydotnet';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
// firebase-tools' own public OAuth client, the one `firebase login` uses.
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// VIEW_CHANNEL|SEND_MESSAGES|READ_MESSAGE_HISTORY|EMBED_LINKS|ATTACH_FILES|ADD_REACTIONS|CONNECT|SPEAK
const DEFAULT_PERMISSIONS = 503;

const args = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};
const OWNER = arg('--owner', 'eC1DRxhbWVNnyCx5I82XYUAsret2'); // Seth
const NAME = arg('--name', 'Maskord');

// ─── Firestore REST ───────────────────────────────────────────────────────────

const configPath = `${process.env.USERPROFILE ?? process.env.HOME}/.config/configstore/firebase-tools.json`;
const refreshToken = JSON.parse(readFileSync(configPath, 'utf8')).tokens?.refresh_token;
if (!refreshToken) throw new Error(`no refresh token in ${configPath} — run \`firebase login\` first`);

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  }),
});
if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
const { access_token: accessToken } = await tokenRes.json();
const auth = { Authorization: `Bearer ${accessToken}` };

/** JS value -> Firestore typed value. `null` means "a null field", not "absent". */
function enc(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  switch (typeof v) {
    case 'string':  return { stringValue: v };
    case 'boolean': return { booleanValue: v };
    case 'number':  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    default: break;
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}

async function getDoc(path) {
  const r = await fetch(`${BASE}/${path}`, { headers: auth });
  return r.ok ? await r.json() : null;
}

/** POST to a collection lets Firestore mint the id, matching `collection().doc()`. */
async function addDoc(collection, data) {
  const r = await fetch(`${BASE}/${collection}`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }),
  });
  if (!r.ok) throw new Error(`create ${collection}: ${r.status} ${await r.text()}`);
  const doc = await r.json();
  return doc.name.split('/').pop();
}

async function setDoc(path, data) {
  const r = await fetch(`${BASE}/${path}`, {
    method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }),
  });
  if (!r.ok) throw new Error(`write ${path}: ${r.status} ${await r.text()}`);
}

// ─── Provision ────────────────────────────────────────────────────────────────

const existing = await getDoc('system/maskordDefaults');
const existingId = existing?.fields?.guildId?.stringValue;
if (existingId && await getDoc(`guilds/${existingId}`)) {
  console.log(`already provisioned: guilds/${existingId}`);
  const code = existing.fields?.inviteCode?.stringValue;
  if (code) console.log(`invite code: ${code}`);
  process.exit(0);
}

const now = new Date();

const guildId = await addDoc('guilds', {
  name: NAME,
  description: 'The shared Maskord server — everyone lands here.',
  iconUrl: '',
  ownerId: OWNER,
  createdAt: now,
  vanityCode: null,
  settings: {
    defaultNotifications: 'all',
    explicitContentFilter: 'disabled',
    verificationLevel: 'none',
    // The point of this server: a guest who clicks "look around" lands here.
    allowGuests: true,
  },
});
console.log(`guild: guilds/${guildId}`);

const everyoneRoleId = await addDoc(`guilds/${guildId}/roles`, {
  name: '@everyone',
  color: '#99AAB5',
  permissions: DEFAULT_PERMISSIONS,
  position: 0,
  hoist: false,
  mentionable: false,
});

// Same three channels createGuildFn makes, so this server is not a special case
// anywhere in the client. #live sits at -1 so it sorts first.
const generalChannelId = await addDoc(`guilds/${guildId}/channels`, {
  name: 'general', type: 'text', position: 0, topic: 'Welcome to Maskord',
  slowmode: 0, nsfw: false, parentId: null, permissionOverwrites: {},
});
await addDoc(`guilds/${guildId}/channels`, {
  name: 'General', type: 'voice', position: 1, topic: null,
  slowmode: 0, nsfw: false, parentId: null, permissionOverwrites: {},
});
await addDoc(`guilds/${guildId}/channels`, {
  name: 'live', type: 'live', position: -1, topic: 'Twitch chat & live stream',
  slowmode: 0, nsfw: false, parentId: null, permissionOverwrites: {},
});

await setDoc(`guilds/${guildId}/members/${OWNER}`, {
  nickname: null, roles: [everyoneRoleId], joinedAt: now,
  muted: false, deafened: false, pending: false,
});
await setDoc(`members_index/${guildId}_${OWNER}`, { guildId, userId: OWNER, joinedAt: now });

// A permanent, unlimited invite: what DEFAULT_INVITE_CODE points at, and what
// anyone can hand out. Same shape and alphabet as createInvite; maxUses and
// expiresAt of null is how it spells "forever, any number of people".
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const inviteCode = Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
await setDoc(`invites/${inviteCode}`, {
  code: inviteCode,
  guildId,
  channelId: generalChannelId,
  inviterId: OWNER,
  uses: 0,
  maxUses: null,
  expiresAt: null,
  createdAt: now,
});
console.log(`invite code: ${inviteCode}`);

await setDoc('system/maskordDefaults', { guildId, inviteCode, provisionedAt: now });
console.log('system/maskordDefaults written');
