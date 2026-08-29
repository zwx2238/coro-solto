import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const basePath = (process.env.PUBLIC_OPEN_GAMES_BASE_PATH ?? '').replace(
  /\/+$/,
  '',
);

if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(basePath)) {
  throw new Error(
    'PUBLIC_OPEN_GAMES_BASE_PATH must be a non-empty absolute URL path',
  );
}

const outputRoot = path.resolve('dist/client');
const topLevelEntries = await readdir(outputRoot);
const localRoots = [...topLevelEntries, 'api']
  .map((entry) => entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .sort((a, b) => b.length - a.length)
  .join('|');
const absoluteLocalPath = new RegExp(
  `(^|[\\s"'\\\`(=,:])/(?=(?:${localRoots})(?:[/?"'\\\`#)\\s]|$))`,
  'gm',
);
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.txt',
  '.webmanifest',
  '.xml',
]);

let rewrittenFiles = 0;

for await (const filePath of walk(outputRoot)) {
  if (!textExtensions.has(path.extname(filePath))) continue;

  const source = await readFile(filePath, 'utf8');
  const rewritten = source.replace(
    absoluteLocalPath,
    (_match, prefix) => `${prefix}${basePath}/`,
  );
  absoluteLocalPath.lastIndex = 0;
  if (absoluteLocalPath.test(rewritten)) {
    throw new Error(
      `${path.relative(outputRoot, filePath)} still contains root-absolute local paths`,
    );
  }

  if (rewritten === source) continue;
  if (path.extname(filePath) === '.json') JSON.parse(rewritten);
  await writeFile(filePath, rewritten, 'utf8');
  rewrittenFiles += 1;
}

for (const relativePath of ['index.html', 'js/main.js', 'style.css']) {
  const content = await readFile(path.join(outputRoot, relativePath), 'utf8');
  absoluteLocalPath.lastIndex = 0;
  if (absoluteLocalPath.test(content)) {
    throw new Error(`${relativePath} still contains root-absolute local paths`);
  }
}

const decalRoot = path.join(outputRoot, 'img', 'decals');
const availableDecals = (await readdir(decalRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
const texturesPath = path.join(outputRoot, 'js', 'textures.js');
const texturesSource = await readFile(texturesPath, 'utf8');
const decalMarker = '  T.decals = [];';
if (!texturesSource.includes(decalMarker)) {
  throw new Error('js/textures.js no longer exposes the reviewed decal marker');
}
const decalFilter = [
  '  const OPEN_GAMES_DECALS = new Set(',
  `    ${JSON.stringify(availableDecals)},`,
  '  );',
  '  for (let i = DECAL_FILES.length - 1; i >= 0; i--) {',
  '    if (!OPEN_GAMES_DECALS.has(DECAL_FILES[i][0])) DECAL_FILES.splice(i, 1);',
  '  }',
  '',
].join('\n');
await writeFile(
  texturesPath,
  texturesSource.replace(decalMarker, `${decalFilter}${decalMarker}`),
  'utf8',
);

console.log(
  `Open Games build: prefixed local URLs in ${rewrittenFiles} files with ${basePath}; kept ${availableDecals.length} committed decals`,
);

async function* walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}
