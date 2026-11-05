// Shared by build-preview.mjs and build-web.mjs: src/ as one page's worth of
// CSS (fonts inlined), JS (every <script> in index.html, in order) and body.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(repo, 'src');

/** This checkout's version (scripts/version.mjs). */
export function version() {
  return execFileSync(process.execPath, [join(repo, 'scripts', 'version.mjs')], { encoding: 'utf8' }).trim();
}

export function bundle() {
  const html = readFileSync(join(src, 'index.html'), 'utf8');
  let css = readFileSync(join(src, 'css', 'app.css'), 'utf8');
  css = css.replace(/url\('\.\.\/fonts\/([^']+)'\)/g, (_, f) => {
    const b64 = readFileSync(join(src, 'fonts', f)).toString('base64');
    return `url(data:font/woff2;base64,${b64})`;
  });
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const js = scripts.map((s) => `/* ${s} */\n${readFileSync(join(src, s), 'utf8').replace(/<\/script/gi, '<\\/script')}`).join('\n');
  const body = html.match(/<body>([\s\S]*?)<script/)[1].trim();
  return { css, js, body };
}
