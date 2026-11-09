// Builds Kino's LAN web UI (./web, or the folder given with --web=<dir>) as an installable LG webOS app: the same files the phone serves, but loaded
// from the TV itself. A packaged app is a local file, which Chromium counts as a secure page: protected (DRM) channels can play
// there, where the phone's plain http page gets no EME at all (measured on the LG OLED55C1, 2026-11-07). It finds the phone with
// the pairing code, as the hosted page does (`?p=<phone>&t=<token>`).
//
//   node build.mjs             -> build/app (the app's files)
//   node build.mjs --package   -> also dist/<id>_<version>_all.ipk, with LG's ares-package
//   node build.mjs --install [--device=lg]   -> packages, installs on the TV and opens the app (one step after the web changes)
//
// webOS's Chromium 79 refuses ES modules from file://, so app.js and its imports are bundled into one classic script.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const webArg = process.argv.find((a) => a.startsWith('--web='));
const web = webArg ? path.resolve(webArg.slice('--web='.length)) : path.join(here, 'web');
const out = path.join(here, 'build', 'app');
const dist = path.join(here, 'dist');

// Scripts the page loads by themselves, as classic scripts, when a stream needs them (hlsplay.js, shakaplay.js): copied as they are.
const CLASSIC = new Set(['hls.min.js', 'shaka-player.compiled.js']);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. The app's descriptor and icons.
for (const f of fs.readdirSync(path.join(here, 'app'))) fs.copyFileSync(path.join(here, 'app', f), path.join(out, f));

// 2. Everything the page uses that is not one of its modules: styles, fonts, the logo, the vendored players and their licenses.
for (const entry of fs.readdirSync(web, { withFileTypes: true })) {
  if (entry.name === 'index.html') continue;
  if (entry.isFile() && entry.name.endsWith('.js') && !CLASSIC.has(entry.name)) continue;
  fs.cpSync(path.join(web, entry.name), path.join(out, entry.name), { recursive: true });
}

// 3. The modules, as one classic script lowered to what Chromium 79 runs.
await build({
  entryPoints: [path.join(web, 'app.js')],
  bundle: true,
  format: 'iife',
  target: 'chrome79',
  outfile: path.join(out, 'app.js'),
  legalComments: 'eof',
  logLevel: 'warning',
});

// 4. The page: the phone's own, loading the bundle as a classic deferred script instead of the module.
const page = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const moduleTag = '<script type="module" src="app.js"></script>';
if (!page.includes(moduleTag)) throw new Error('index.html no longer loads app.js as ' + moduleTag + ': update build.mjs');
// Its policy names the app's own files: on webOS's Chromium 79 'self' does not match file://, which refused the script and the
// styles (measured on the LG, 2026-11-07), so file: stands next to each 'self'. The phone's page keeps its policy as it is.
if (!/Content-Security-Policy/.test(page)) throw new Error('index.html has no Content-Security-Policy: update build.mjs');
const packaged = page.replace(moduleTag, '<script src="app.js" defer></script>').replace(/'self'/g, "'self' file:");
fs.writeFileSync(path.join(out, 'index.html'), packaged);

// 4a. The LG app is kinoverse: its wordmark (brand/logo.svg), and its name where the page names itself. The phone's own page keeps Kino's.
fs.copyFileSync(path.join(here, 'brand', 'logo.svg'), path.join(out, 'logo.svg'));
const bundle = path.join(out, 'app.js');
const named = fs.readFileSync(bundle, 'utf8').replace(/appName: (['"])Kino\1/g, 'appName: $1kinoverse$1');
if (!/appName: (['"])kinoverse\1/.test(named)) throw new Error('app.js no longer names the app as appName: "Kino": update build.mjs');
fs.writeFileSync(bundle, named);

// 4b. What kinoverse.app serves at /tv/webos/: the same program the app carries (everything but the app's descriptor, icons and page).
// The installed app loads it from there each time it opens, so a new version reaches every TV with no reinstall.
const remote = path.join(here, 'build', 'remote');
fs.rmSync(remote, { recursive: true, force: true });
fs.cpSync(out, remote, { recursive: true });
for (const f of ['appinfo.json', 'icon80.png', 'icon130.png', 'index.html']) fs.rmSync(path.join(remote, f), { force: true });

// 4c. The installed app's own page is the shell: boot.js loads the program from kinoverse.app, and the copy above when it cannot.
fs.copyFileSync(path.join(here, 'shell', 'index.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(here, 'shell', 'boot.js'), path.join(out, 'boot.js'));

const info = JSON.parse(fs.readFileSync(path.join(out, 'appinfo.json'), 'utf8'));
for (const f of [info.main, info.icon, info.largeIcon, 'app.js', 'styles.css']) {
  if (!fs.existsSync(path.join(out, f))) throw new Error('the build is missing ' + f);
}
console.log('built ' + path.relative(process.cwd(), out) + ' (' + info.id + ' ' + info.version + ')');

// 5. The .ipk, and with --install the TV gets it and opens it.
const install = process.argv.includes('--install');
const device = (process.argv.find((a) => a.startsWith('--device=')) || '--device=lg').slice('--device='.length);
function ares(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(cmd + ' failed'); process.exit(r.status || 1); }
}
if (install || process.argv.includes('--package')) {
  fs.mkdirSync(dist, { recursive: true });
  for (const f of fs.readdirSync(dist)) if (f.endsWith('.ipk')) fs.rmSync(path.join(dist, f));
  ares('ares-package', [JSON.stringify(out), '-o', JSON.stringify(dist)]);
  const ipk = fs.readdirSync(dist).filter((f) => f.endsWith('.ipk'));
  if (!ipk.length) { console.error('ares-package made no .ipk'); process.exit(1); }
  console.log('packaged ' + ipk.map((f) => path.join(path.relative(process.cwd(), dist), f)).join(', '));
  if (install) {
    ares('ares-install', ['-d', device, JSON.stringify(path.join(dist, ipk[0]))]);
    ares('ares-launch', ['-d', device, info.id]);
    console.log('installed and opened ' + info.id + ' on ' + device);
  }
}
