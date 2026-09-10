#!/usr/bin/env node
// One-time migration: add #live channel to all existing guilds that don't have one.
// Run from the functions directory:
//   node scripts/add-live-channels.mjs
//
// Uses the service-account.json in this directory for admin SDK access.
// Safe to re-run — skips any guild that already has a type='live' channel.

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

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  console.log('Fetching all guilds…');
  const guildsSnap = await db.collection('guilds').get();
  console.log(`Found ${guildsSnap.size} guild(s).`);

  let skipped = 0;
  let created = 0;
  let errors  = 0;

  await Promise.all(guildsSnap.docs.map(async (guildDoc) => {
    const guildId   = guildDoc.id;
    const guildName = guildDoc.data().name ?? guildId;

    try {
      // Check if a live channel already exists
      const existingSnap = await db
        .collection(`guilds/${guildId}/channels`)
        .where('type', '==', 'live')
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        console.log(`  [skip]   ${guildName} (${guildId}) — already has #live`);
        skipped++;
        return;
      }

      // Create the #live channel
      await db.collection(`guilds/${guildId}/channels`).add({
        name:                'live',
        type:                'live',
        position:            -1,
        topic:               'Twitch chat & live stream',
        slowmode:            0,
        nsfw:                false,
        parentId:            null,
        permissionOverwrites: {},
      });

      console.log(`  [created] ${guildName} (${guildId})`);
      created++;
    } catch (err) {
      console.error(`  [error]   ${guildName} (${guildId}):`, err.message);
      errors++;
    }
  }));

  console.log(`\nDone. created=${created}  skipped=${skipped}  errors=${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
