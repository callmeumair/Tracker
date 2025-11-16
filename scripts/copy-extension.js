import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const dist = path.resolve('dist/extension');
  const manifestSrc = path.resolve('manifest.json');
  const manifestDest = path.join(dist, 'manifest.json');
  await fs.copyFile(manifestSrc, manifestDest);
  console.log('[extension-build] Copied manifest.json');
}

main().catch((error) => {
  console.error('Failed to copy extension files', error);
  process.exit(1);
});

