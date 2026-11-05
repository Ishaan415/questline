// Builds the website: the homepage (docs/) plus the browser version of
// Questline at app/, ready for GitHub Pages.
//
//   node scripts/build-web.mjs [out-dir]        default: dist-web/
//
// Settings (environment variables; the Pages workflow sets them):
//   QUESTLINE_GOOGLE_WEB_CLIENT_ID  Google OAuth client of type "Web application"
//                                   (public, not a secret). Without it the web
//                                   version runs without Google sign-in.
//   QUESTLINE_WEB_URL               where app/ is served; must match the client's
//                                   redirect URI exactly. Default: the GitHub Pages
//                                   address. Set it to "auto" to use whatever
//                                   address the page is opened at (local testing).
//   QUESTLINE_VERSION               version to show (default: scripts/version.mjs).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundle, repo, version } from './bundle.mjs';

const out = resolve(process.argv[2] || join(repo, 'dist-web'));
const app = join(out, 'app');
const v = process.env.QUESTLINE_VERSION || version();
const clientId = (process.env.QUESTLINE_GOOGLE_WEB_CLIENT_ID || '').trim();
const urlEnv = (process.env.QUESTLINE_WEB_URL || 'https://ishaan415.github.io/questline/app/').trim();
const appUrl = urlEnv === 'auto' ? null : urlEnv.replace(/\/?$/, '/');

if (clientId && !clientId.endsWith('.apps.googleusercontent.com')) {
  throw new Error('QUESTLINE_GOOGLE_WEB_CLIENT_ID should end in .apps.googleusercontent.com');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
cpSync(join(repo, 'docs'), out, { recursive: true });
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) cpSync(join(repo, 'web', f), join(app, f));

const { css, js, body } = bundle();
const config = { googleClientId: clientId || null, appUrl };
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Questline</title>
<meta name="description" content="A cozy pixel-RPG planner: dailies, reminders, a calendar, focus mode and pals. Runs in your browser; syncs with the Windows and Android apps through your Google Drive.">
<meta name="theme-color" content="#E6F2DF">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Questline">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="referrer" content="no-referrer">
<style>
${css}
</style>
</head>
<body>
${body}
<script>window.QUESTLINE_WEB = ${JSON.stringify(config)}; window.QUESTLINE_VERSION = ${JSON.stringify(v)};</script>
<script>
${js}
</script>
<script>if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>
</body>
</html>
`;
writeFileSync(join(app, 'index.html'), page);

const manifest = {
  name: 'Questline', short_name: 'Questline',
  description: 'A cozy pixel-RPG planner for dailies, reminders, calendar and focus.',
  id: './', start_url: './', scope: './', display: 'standalone', orientation: 'any',
  background_color: '#E6F2DF', theme_color: '#E6F2DF',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync(join(app, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(app, 'version.json'), `${JSON.stringify({ version: v })}\n`);
writeFileSync(join(app, 'sw.js'), readFileSync(join(repo, 'web', 'sw.js'), 'utf8').replace('__VERSION__', v));

console.log(`wrote ${out} (Questline ${v}, app ${(page.length / 1024).toFixed(0)} KB, Google sign-in ${clientId ? 'on' : 'off'})`);
