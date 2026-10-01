// Self-hosted cleanup regression: APOIE/support, social, newsletter e /_vercel
// insights fora do build Open Games. Run: node test/open-games-selfhosted-cleanup.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(desc, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${desc}`);
  if (!ok) failures++;
}
function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const index = read('src/pages/index.astro');
check('menu APOIE button is self-hosted gated', /\{!OPEN_GAMES_SELF_HOSTED && \(\s*<button class="cs-item" data-act="apoie"/.test(index));
check('mf-social Discord icon is self-hosted gated', /\{!OPEN_GAMES_SELF_HOSTED && \(\s*<a href=\{DISCORD_URL\}/.test(index));
check('mf-social Telegram icon is self-hosted gated', /\{!OPEN_GAMES_SELF_HOSTED && \(\s*<a href=\{TELEGRAM_URL\}/.test(index));
check('mf-social GitHub icon stays ungated', !/\{!OPEN_GAMES_SELF_HOSTED && \(\s*<a href=\{GITHUB_URL\}/.test(index));
check('support panel markup is self-hosted gated', /\{!OPEN_GAMES_SELF_HOSTED && \(\s*<div id="support-panel"/.test(index));
check('feedback panel markup stays available', index.includes('<div id="feedback-panel" class="screen hidden">'));
check('newsletter consent stays labeled as optional', index.includes('newsletter') && index.includes('id="fb-news"'));
check('newsletter checkbox is not served in self-hosted', /\{!OPEN_GAMES_SELF_HOSTED && \(\s*<label class="fb-consent">/.test(index));

const main = read('public/js/main.js');
check('apoie menu action is self-hosted guarded', main.includes("case 'apoie': if (!selfHosted) { markCurrent('apoie'); showSupport(); } break;"));
check('support handlers wired only outside self-hosted', /if \(!selfHosted\) \{\s*\$\('support-back'\)\.onclick/.test(main));
check('screens list drops support-panel in self-hosted', /\.filter\(\(s\) => !\(selfHosted && s === 'support-panel'\)\)/.test(main));
check('newsletter consent no longer blocks feedback', !main.includes("if (!news) return falha"));
check('feedback payload keeps newsletter boolean field', main.includes("api('/api/feedback', { email, newsletter: news"));
check('feedback payload forces newsletter=false in self-hosted', main.includes("const news = selfHosted ? false : $('fb-news').checked"));
check('feedback still requires valid email', main.includes("@[^@\\s]+\\.[^@\\s]+"));

const feedbackApi = read('src/pages/api/feedback.ts');
check('feedback API keeps newsletter contract field', feedbackApi.includes('p_newsletter: newsletter === true'));
check('feedback API accepts newsletter false', !/newsletter !== true[^]*?bad_/.test(feedbackApi));

const layout = read('src/layouts/Layout.astro');
check('Layout reads PUBLIC_OPEN_GAMES_SELF_HOSTED', layout.includes("import.meta.env.PUBLIC_OPEN_GAMES_SELF_HOSTED === '1'"));
check('Layout head-social Discord is self-hosted gated', /\{!OPEN_GAMES_SELF_HOSTED && \(\s*<a href=\{DISCORD_URL\} rel="noopener"/.test(layout));
check('Layout head-social Telegram is self-hosted gated', /\{!OPEN_GAMES_SELF_HOSTED && \(\s*<a href=\{TELEGRAM_URL\} rel="noopener"/.test(layout));
check('Layout head-social GitHub stays ungated', !/\{!OPEN_GAMES_SELF_HOSTED && \(\s*<a href=\{GITHUB_URL\}/.test(layout));
check('Layout PLAY link uses the same explicit game base', layout.includes('class="btn-play" href={GAME_BASE}') && layout.includes("jogar.setAttribute('href', `${GAME_BASE}?lang=en`)"));
check('Layout imports the same base in server and client code', (layout.match(/import \{ GAME_BASE \} from '\.\.\/lib\/game-base';/g) || []).length === 2);
check('Layout brand and footer do not jump to the host root', !layout.includes('href="/"'));
for (const [page, target] of [['about', 'sobre'], ['sobre', 'about']]) {
  const source = read(`src/pages/${page}.astro`);
  check(`${page} play link uses the game base`, /class="btn-cta" href=\{(?:GAME_BASE|`\$\{GAME_BASE\}\?lang=en`)\}/.test(source));
  check(`${page} language redirect stays under the game base`, source.includes('location.replace(`${GAME_BASE}' + target + '`)'));
  check(`${page} imports the same base in server and client code`, (source.match(/import \{ GAME_BASE \} from '\.\.\/lib\/game-base';/g) || []).length === 2);
}
const gameBaseExpression = read('src/lib/game-base.ts').match(/export const GAME_BASE = ([^]*);\s*$/)?.[1] ?? '';
check('game base reads the explicit platform path, never generic BASE_URL', gameBaseExpression.includes('import.meta.env.PUBLIC_OPEN_GAMES_BASE_PATH') && !gameBaseExpression.includes('import.meta.env.BASE_URL'));
for (const configuredBase of [undefined, '', '/', '/services/open-games/games/coro-solto', '/services/open-games/games/coro-solto/']) {
  const expected = configuredBase ? `${configuredBase.replace(/\/+$/, '')}/` : '/';
  const expression = gameBaseExpression.replaceAll('import.meta.env.PUBLIC_OPEN_GAMES_BASE_PATH', 'configuredBase');
  check(`game base is absolute and normalized (${configuredBase})`, expression && vm.runInNewContext(expression, { configuredBase }) === expected);
}

const textures = read('public/js/textures.js');
const textureLoads = [...textures.matchAll(/_tl\.load\((.*?)(?:, undefined, undefined,|\);)/g)].map((m) => m[1]);
check('all four file texture loading paths are covered', textureLoads.length === 4);
const textureFiles = ['posters/fixture.png', 'posters/fixture.png', 'posters/or-mural-fixture.jpg', 'img/decals/fixture.png'];
for (const base of ['/', '/games/coro-solto/']) {
  const moduleUrl = `https://games.example.com${base}js/textures.js?v=fixture`;
  const pathsResolve = (expressions) => expressions.length === textureFiles.length && expressions.every((expression, i) => {
    const url = vm.runInNewContext(expression.replaceAll('import.meta.url', 'moduleUrl'), { URL, moduleUrl, f: 'fixture.png', n: 'fixture' });
    return ['', 'about/', 'sobre/'].every((page) => new URL(url, `https://games.example.com${base}${page}`).href === `https://games.example.com${base}${textureFiles[i]}`);
  });
  check(`file textures resolve from the module on root and nested pages (${base})`, pathsResolve(textureLoads));
  const mutant = textureLoads.map((expression) => expression.replace(/^new URL\((.*), import\.meta\.url\)\.href$/, '$1').replace(/^'\.\.\//, "'"));
  check(`mutation removes module resolution (${base})`, mutant.some((expression, i) => expression !== textureLoads[i]));
  check(`nested-page invariant rejects document-relative mutant (${base})`, !pathsResolve(mutant));
}

const apoie = read('src/pages/apoie.astro');
check('apoie route redirects self-hosted requests to About', /if \(OPEN_GAMES_SELF_HOSTED\) \{[^]*?return Astro\.redirect\(`\$\{base\}\/about\/`\);/.test(apoie));
check('apoie has no replacement marketing message', !apoie.includes('O apoio ao projeto acontece no site oficial'));
check('apoie support CTAs live only in the non-self-hosted branch', (apoie.match(/class="support-cta"/g) || []).length === 2);

const inlineScripts = [...index.matchAll(/<script is:inline>([^]*?)<\/script>/g)].map((m) => m[1]);
const insightsSource = inlineScripts.find((s) => s.includes('/_vercel/insights/script.js')) ?? '';
check('inline Vercel insights script exists in index.astro', insightsSource.length > 0);
check('inline insights script is self-hosted gated', insightsSource.includes('!window.__OPEN_GAMES_SELF_HOSTED__ && !/^(localhost'));

function runInsightsScript(source, { hostname, selfHosted }) {
  const appended = [];
  const document = {
    head: { appendChild: (el) => appended.push(el.src) },
    createElement: () => ({ defer: false, src: '' }),
  };
  const window = {};
  if (selfHosted) window.__OPEN_GAMES_SELF_HOSTED__ = true;
  vm.runInContext(source, vm.createContext({ window, document, location: { hostname } }), { timeout: 1000 });
  return appended;
}

if (insightsSource) {
  const upstream = ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js'];
  check('VM: self-hosted public host loads 0 analytics scripts', runInsightsScript(insightsSource, { hostname: 'games.example.com', selfHosted: true }).length === 0);
  check('VM: non-self-hosted public host keeps upstream analytics', JSON.stringify(runInsightsScript(insightsSource, { hostname: 'games.example.com', selfHosted: false })) === JSON.stringify(upstream));
  check('VM: localhost still loads 0 analytics scripts', runInsightsScript(insightsSource, { hostname: 'localhost', selfHosted: false }).length === 0);

  const mutant = insightsSource.replace('!window.__OPEN_GAMES_SELF_HOSTED__ && ', '');
  check('mutant applies (guard actually removed)', mutant !== insightsSource);
  check('VM catches mutant: unguarded script hits network on self-hosted host', runInsightsScript(mutant, { hostname: 'games.example.com', selfHosted: true }).length === upstream.length);
}

if (process.argv.includes('--built')) {
  const base = `${(process.env.PUBLIC_OPEN_GAMES_BASE_PATH ?? '').replace(/\/+$/, '')}/`;
  const assets = join(root, 'dist/client/_astro');
  const modules = readdirSync(assets).filter((name) => /^game-base\..*\.js$/.test(name));
  check('build emits one shared navigation base module', modules.length === 1);
  if (modules.length === 1) {
    const exported = Object.values(await import(pathToFileURL(join(assets, modules[0]))));
    check('built navigation base ignores BASE_URL=./', exported.length === 1 && exported[0] === base);
  }
  for (const page of ['about', 'sobre']) {
    const html = read(`dist/client/${page}/index.html`);
    check(`built ${page} play CTA stays under the game path`, html.includes(`class="btn-cta" href="${base}${page === 'about' ? '?lang=en' : ''}"`));
    check(`built ${page} header PLAY stays under the game path`, html.includes(`class="btn-play" href="${base}"`));
    check(`built ${page} brand stays under the game path`, html.includes(`class="brand" href="${base}"`));
  }
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('open-games self-hosted cleanup checks passed');
