// Bundles src/ into one self-contained HTML file (fonts, CSS and JS inlined)
// for the web preview with sample data. The desktop app does not use this; it
// serves src/ directly. The real browser version is scripts/build-web.mjs.
//   node scripts/build-preview.mjs [out.html]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundle, repo, version } from './bundle.mjs';

const out = process.argv[2] || resolve(repo, 'questline-preview.html');
const { css, js, body } = bundle();

const page = `<title>Questline</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="A cozy pixel-RPG planner: dailies with times, reminders, a full calendar, focus mode and Spotify controls.">
<style>
${css}
</style>
${body}
<script>window.QUESTLINE_DEMO = true; window.QUESTLINE_VERSION = ${JSON.stringify(version())};</script>
<script>
${js}
</script>
`;
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
