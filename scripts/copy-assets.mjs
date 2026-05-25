#!/usr/bin/env node
/**
 * Postbuild: copy non-TS assets that tsc ignores into dist/.
 *  - src/hub/db/migrations/*.sql -> dist/hub/db/migrations/ (Hub runtime needs them)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  let entries = [];
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
  return true;
}

const pairs = [
  ['src/hub/db/migrations', 'dist/hub/db/migrations'],
];
let copied = 0;
for (const [s, d] of pairs) {
  const ok = await copyDir(path.join(root, s), path.join(root, d));
  if (ok) copied++;
}
process.stdout.write(`copy-assets: ${copied}/${pairs.length} sources copied\n`);
