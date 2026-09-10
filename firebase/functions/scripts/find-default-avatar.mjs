#!/usr/bin/env node
// One-off: locate the default "Masky" avatar owned by the `simplystrong` Twitch
// user, so we can hard-code its IDs in app/shared/src/constants/claudeAvatar.ts.
//
// Run:  node scripts/find-default-avatar.mjs

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(
  readFileSync(join(__dirname, '..', 'service-account.json'), 'utf8'),
);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const TARGET_USERNAME = 'simplystrong';

async function run() {
  // Twitch-auth users live at users/twitch:{twitchId} with `twitchUsername` set.
  const usersSnap = await db.collection('users')
    .where('twitchUsername', '==', TARGET_USERNAME)
    .get();

  if (usersSnap.empty) {
    console.error(`No user found with twitchUsername == ${TARGET_USERNAME}`);
    process.exit(1);
  }
  if (usersSnap.size > 1) {
    console.warn(`Multiple users matched twitchUsername == ${TARGET_USERNAME} — using the first.`);
  }

  const userDoc = usersSnap.docs[0];
  const ownerUid = userDoc.id;
  const u = userDoc.data();
  console.log(`\nOwner found:`);
  console.log(`  uid:           ${ownerUid}`);
  console.log(`  displayName:   ${u.displayName ?? '(none)'}`);
  console.log(`  twitchId:      ${u.twitchId ?? '(none)'}`);

  const groupsSnap = await db.collection('users').doc(ownerUid).collection('avatarGroups').get();
  if (groupsSnap.empty) {
    console.error(`\nNo avatarGroups under users/${ownerUid}.`);
    process.exit(1);
  }

  console.log(`\nAvatar groups (${groupsSnap.size}):`);
  for (const g of groupsSnap.docs) {
    const d = g.data();
    console.log(`  • id=${g.id}`);
    console.log(`      displayName: ${d.displayName ?? '(none)'}`);
    console.log(`      humeVoiceId: ${d.humeVoiceId ?? '(none)'}`);
    console.log(`      avatarUrl:   ${d.cachedAvatarUrl ?? d.avatarUrl ?? '(none)'}`);
  }

  // Try to find one literally named "Masky" (case-insensitive).
  const masky = groupsSnap.docs.find(
    (g) => String(g.data().displayName ?? '').trim().toLowerCase() === 'masky',
  );
  if (masky) {
    console.log(`\n→ Default candidate: avatarId=${masky.id} (displayName="${masky.data().displayName}")`);
    console.log(`\nDrop these into app/shared/src/constants/claudeAvatar.ts:`);
    console.log(`  ownerUid: '${ownerUid}',`);
    console.log(`  avatarId: '${masky.id}',`);
  } else {
    console.log(`\nNo avatar literally named "Masky" yet — pick one above and update the constants by hand, or create it in masky.ai first.`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
