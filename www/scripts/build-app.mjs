/**
 * Builds the Maskord web client and folds it into the site bundle.
 *
 * Convex Static Hosting publishes a single directory, so the client — which is
 * built with `base: '/app/'` — is copied to www/dist/app. That keeps
 * hackathon.maskord.com/app/ byte-for-byte the same path the client already
 * expects on maskord.com/app.
 */
import { execSync } from 'node:child_process';
import { cp, readdir, rename, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const wwwDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(wwwDir);
const clientDist = path.join(repoRoot, 'app', 'desktop', 'dist-web');
const target = path.join(wwwDir, 'dist', 'app');

// Run through a shell: on Windows npm is a .cmd shim, which Node will not spawn
// directly.
console.log('building the Maskord web client…');
execSync('npm run build:web --workspace=app/desktop', {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (!(await stat(clientDist).catch(() => null))) {
  throw new Error(`client build produced no output at ${clientDist}`);
}

await rm(target, { recursive: true, force: true });
await cp(clientDist, target, { recursive: true });
console.log(`copied client build -> ${path.relative(repoRoot, target)}`);

// The agent game rooms (/wizard.html, /wizardmap.html, /debate.html,
// /debatestats.html) are their own bundle with base '/rooms/'. Each page is
// published at the site root with its assets under /rooms/, so the client at
// /app/ stays exactly what its own build produced.
const roomsDist = path.join(repoRoot, 'app', 'desktop', 'dist-rooms');
const roomsTarget = path.join(wwwDir, 'dist', 'rooms');

console.log('building the rooms…');
execSync('npm run build:rooms --workspace=app/desktop', {
  cwd: repoRoot,
  stdio: 'inherit',
});

await rm(roomsTarget, { recursive: true, force: true });
await cp(roomsDist, roomsTarget, { recursive: true });
const pages = (await readdir(roomsTarget)).filter((f) => f.endsWith('.html'));
if (pages.length === 0) throw new Error(`rooms build produced no pages at ${roomsDist}`);
for (const page of pages) {
  await rename(path.join(roomsTarget, page), path.join(wwwDir, 'dist', page));
}
console.log(`copied rooms -> ${pages.map((p) => '/' + p).join(', ')}`);
