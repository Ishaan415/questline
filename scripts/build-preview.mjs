// Bundles src/ into one self-contained HTML file (fonts, CSS and JS inlined)
// for the web preview. The desktop app does not use this; it serves src/ directly.
//   node scripts/build-preview.mjs [out.html]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const out = process.argv[2] || resolve(root, '..', 'questline-preview.html');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const version = execFileSync(process.execPath, [join(root, '..', 'scripts', 'version.mjs')], { encoding: 'utf8' }).trim();

let css = readFileSync(join(root, 'css', 'app.css'), 'utf8');
css = css.replace(/url\('\.\.\/fonts\/([^']+)'\)/g, (_, f) => {
  const b64 = readFileSync(join(root, 'fonts', f)).toString('base64');
  return `url(data:font/woff2;base64,${b64})`;
});

const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = scripts.map((s) => `/* ${s} */\n${readFileSync(join(root, s), 'utf8').replace(/<\/script/gi, '<\\/script')}`).join('\n');

const body = html.match(/<body>([\s\S]*?)<script/)[1].trim();
const page = `<title>Questline</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="A cozy pixel-RPG planner: dailies with times, reminders, a full calendar, focus mode and Spotify controls.">
<style>
${css}
</style>
${body}
<script>window.QUESTLINE_DEMO = true; window.QUESTLINE_VERSION = ${JSON.stringify(version)};</script>
<script>
${js}
</script>
`;
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
