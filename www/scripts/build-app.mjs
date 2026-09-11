/**
 * Builds the Maskord web client and folds it into the site bundle.
 *
 * Convex Static Hosting publishes a single directory, so the client — which is
 * built with `base: '/app/'` — is copied to www/dist/app. That keeps
 * hackathon.maskord.com/app/ byte-for-byte the same path the client already
 * expects on maskord.com/app.
 */
import { execSync } from 'node:child_process';
import { cp, rename, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const wwwDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(wwwDir);
const clientDist = path.join(repoRoot, 'app', 'desktop', 'dist-web');
const target = path.join(wwwDir, 'dist', 'app');
const sttDist = path.join(repoRoot, 'app', 'desktop', 'dist-stt');
const sttTarget = path.join(wwwDir, 'dist', 'stt');

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

// The STT harness is its own bundle (base '/stt/'), published as /stt.html with
// its assets under /stt/. It shares nothing with the client build, so the two
// can be published from different commits — which is how the harness gets used:
// testing a client change before it is the client everyone loads.
console.log('building the STT harness…');
execSync('npm run build:stt --workspace=app/desktop', {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (!(await stat(path.join(sttDist, 'stt.html')).catch(() => null))) {
  throw new Error(`STT harness build produced no stt.html at ${sttDist}`);
}

await rm(sttTarget, { recursive: true, force: true });
await cp(sttDist, sttTarget, { recursive: true });
await rename(path.join(sttTarget, 'stt.html'), path.join(wwwDir, 'dist', 'stt.html'));
console.log(`copied STT harness -> ${path.relative(repoRoot, path.join(wwwDir, 'dist', 'stt.html'))}`);
