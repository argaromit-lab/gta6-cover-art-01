import { cpSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const screenshotsDir = resolve(__dirname, 'screenshots');

let screenshotFiles: string[] = [];
try {
  const entries = readdirSync(screenshotsDir);
  screenshotFiles = entries.filter(file => {
    const ext = extname(file).toLowerCase();
    return ['.jpg', '.jpeg', '.png'].includes(ext) && statSync(resolve(screenshotsDir, file)).isFile();
  });
} catch (err) {
  throw new Error(`Failed to read screenshots directory at ${screenshotsDir}: ${err instanceof Error ? err.message : String(err)}`);
}

if (screenshotFiles.length < 3 || screenshotFiles.length > 4) {
  throw new Error(`Validation failed: expected exactly 3 or 4 JPEG/PNG screenshot files in ${screenshotsDir}, but found ${screenshotFiles.length} (${screenshotFiles.join(', ')})`);
}

mkdirSync(out, { recursive: true });
for (const folder of ['app', 'screenshots']) {
  cpSync(resolve(__dirname, folder), resolve(out, folder), { recursive: true });
}

writeFileSync(
  resolve(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 50331648,
    app_path_max_bytes: 1000,
  }),
  'utf8'
);

console.log(`Successfully built dossier and copied app and screenshots to ${out} using ${screenshotFiles.length} screenshots.`);
