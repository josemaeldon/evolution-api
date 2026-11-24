import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const assets = join(dist, 'assets');
const bundleName = readdirSync(assets).find((file) => /^index-.*\.js$/.test(file) && file !== 'index-local-assets.js');

if (!bundleName) throw new Error('Manager JavaScript bundle not found');

const bundlePath = join(assets, bundleName);
const localizedBundle = readFileSync(bundlePath, 'utf8').replace(
  /https:\/\/evolution-api\.com\/files\/evo\/evolution-logo(?:-white)?\.svg/g,
  '/assets/images/evolution-logo.png',
);
const version = createHash('sha256').update(localizedBundle).digest('hex').slice(0, 12);
const localBundleName = 'index-local-assets.js';

writeFileSync(join(assets, localBundleName), localizedBundle);
unlinkSync(bundlePath);

const indexPath = join(dist, 'index.html');
const index = readFileSync(indexPath, 'utf8')
  .replace('https://evolution-api.com/files/evo/favicon.svg', '/assets/images/evolution-logo.png')
  .replace(`/assets/${bundleName}`, `/assets/${localBundleName}?v=${version}`);
writeFileSync(indexPath, index);
