// One place for Questline's version.
//
// The release series (major.minor) is the "version" in package.json; each
// release in a series gets the next patch number from the vX.Y.* git tags.
// src-tauri/tauri.conf.json reads its version from package.json.
//
//   node scripts/version.mjs              print the version of this checkout (newest release tag in the series)
//   node scripts/version.mjs next         print the next release version (CI; asks GitHub for tags)
//   node scripts/version.mjs write 0.6.2  write a version into package.json, tauri.conf.json and Cargo.toml (CI)
//   node scripts/version.mjs tauri dev    run the Tauri CLI with this checkout's version (npm run dev / build)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const series = pkg.version.split('.').slice(0, 2).join('.');
const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const patchOf = (tag) => Number(tag.trim().replace(/^.*refs\/tags\//, '').replace(/^v/, '').split('.')[2]);
const patches = (lines) => lines.split('\n').map((l) => l.trim()).filter((l) => l && !l.endsWith('^{}')).map(patchOf).filter(Number.isFinite);

/** Newest release in this series known to the local clone, else package.json. */
function current() {
  const p = patches(git('tag', '--list', `v${series}.*`));
  return p.length ? `${series}.${Math.max(...p)}` : pkg.version;
}

/** Next release: count the series' tags on GitHub (same rule the workflow always used). */
function next() {
  const n = patches(git('ls-remote', '--tags', 'origin', `refs/tags/v${series}.*`)).length;
  return `${series}.${n}`;
}

function write(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`Not a version: ${v}`);
  pkg.version = v;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  // CI also pins the number in tauri.conf.json, for tools that don't follow its
  // "../package.json" link.
  const conf = join(root, 'src-tauri', 'tauri.conf.json');
  const c = JSON.parse(readFileSync(conf, 'utf8'));
  c.version = v;
  writeFileSync(conf, `${JSON.stringify(c, null, 2)}\n`);
  const cargo = join(root, 'src-tauri', 'Cargo.toml');
  writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = "[^"]*"/m, `version = "${v}"`));
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd) console.log(current());
else if (cmd === 'next') console.log(next());
else if (cmd === 'write') write(rest[0]);
else if (cmd === 'tauri') {
  // Pass the version as a config overlay so no tracked file changes.
  const dir = join(root, 'src-tauri', 'target');
  mkdirSync(dir, { recursive: true });
  const overlay = join(dir, 'version.conf.json');
  writeFileSync(overlay, JSON.stringify({ version: current() }));
  console.log(`Questline ${current()}`);
  const win = process.platform === 'win32';
  const r = spawnSync(win ? 'npx.cmd' : 'npx', ['tauri', ...rest, '--config', overlay], { cwd: root, stdio: 'inherit', shell: win });
  process.exit(r.status ?? 1);
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
