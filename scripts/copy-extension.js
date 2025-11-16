import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const dist = path.resolve('dist/extension');
  const manifestSrc = path.resolve('manifest.json');
  const manifestDest = path.join(dist, 'manifest.json');
  
  // Read and update manifest to include CSS
  const manifestContent = await fs.readFile(manifestSrc, 'utf-8');
  const manifest = JSON.parse(manifestContent);
  
  // Find CSS files in assets
  const assetsDir = path.join(dist, 'assets');
  try {
    const files = await fs.readdir(assetsDir);
    const cssFiles = files.filter((f) => f.endsWith('.css'));
    
    if (cssFiles.length > 0 && manifest.content_scripts && manifest.content_scripts[0]) {
      manifest.content_scripts[0].css = cssFiles.map((f) => `assets/${f}`);
      console.log('[extension-build] Added CSS files to manifest:', manifest.content_scripts[0].css);
    }
  } catch (error) {
    console.warn('[extension-build] Could not find assets directory, CSS may be bundled in JS');
  }
  
  await fs.writeFile(manifestDest, JSON.stringify(manifest, null, 2));
  console.log('[extension-build] Copied and updated manifest.json');
}

main().catch((error) => {
  console.error('Failed to copy extension files', error);
  process.exit(1);
});

