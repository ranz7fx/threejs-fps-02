// Entry point for the make.fun threejs-fps-02 submission.
//
// Copies the playable game (game/) and its screenshots (screenshots/)
// from beside this file into the output directory, then writes
// dossier.json there with buildDossier from vendor/makefun-threejs.ts.
//
// Run it with Node 22+ (standard library only, no build step):
//   MAKEFUN_OUTPUT_DIR=out node main.ts
// Outside the grader MAKEFUN_OUTPUT_DIR stands in for /output.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The caps the bounty fixes for the dossier: the text the judge reads is
// capped at 160 KiB, at most 4 screenshots of at most 256 KiB each, and
// game/ holds at most 993 entries / 48 MiB so that /output stays within
// the platform's own 1000-entry, 64 MiB cap together with screenshots/
// and dossier.json.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
} as const;

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

function copyTree(name: string): void {
  const source = join(repoRoot, name);
  if (!existsSync(source)) {
    throw new Error(`missing ${name}/ beside main.ts (${source})`);
  }
  cpSync(source, join(outputDir, name), { recursive: true });
}

mkdirSync(outputDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

const dossier = buildDossier(outputDir, DOSSIER_CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);
console.log(`wrote ${join(outputDir, 'dossier.json')} (${dossier.length} bytes)`);
