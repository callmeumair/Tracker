import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function buildContent() {
  console.log('[extension-build] Building content.js as IIFE...');
  await build({
    plugins: [react()],
    build: {
      outDir: 'dist/extension',
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(root, 'src/content/recorder.tsx'),
        output: {
          entryFileNames: 'content.js',
          format: 'iife',
          name: 'BrowserRecorder',
          inlineDynamicImports: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(root, 'src'),
      },
    },
  });
}

async function buildBackground() {
  console.log('[extension-build] Building background.js as ES module...');
  await build({
    build: {
      outDir: 'dist/extension',
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(root, 'src/background.ts'),
        output: {
          entryFileNames: 'background.js',
          format: 'es',
        },
      },
    },
  });
}

async function copyIcons() {
  const dist = path.resolve(root, 'dist/extension');
  const iconsSrc = path.resolve(root, 'public/icons');
  const iconsDest = path.join(dist, 'icons');
  
  try {
    await fs.mkdir(iconsDest, { recursive: true });
    const files = await fs.readdir(iconsSrc);
    
    for (const file of files) {
      const srcPath = path.join(iconsSrc, file);
      const destPath = path.join(iconsDest, file);
      await fs.copyFile(srcPath, destPath);
    }
    console.log('[extension-build] Copied icon files');
  } catch (error) {
    console.warn('[extension-build] Could not copy icons:', error.message);
  }
}

async function copyManifest() {
  const dist = path.resolve(root, 'dist/extension');
  const manifestSrc = path.resolve(root, 'manifest.json');
  const manifestDest = path.join(dist, 'manifest.json');
  
  const manifestContent = await fs.readFile(manifestSrc, 'utf-8');
  const manifest = JSON.parse(manifestContent);
  
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

async function main() {
  // Ensure dist/extension exists
  await fs.mkdir(path.resolve(root, 'dist/extension'), { recursive: true });
  
  // Clean assets but keep directory
  const assetsDir = path.resolve(root, 'dist/extension/assets');
  try {
    const files = await fs.readdir(assetsDir);
    for (const file of files) {
      await fs.unlink(path.join(assetsDir, file));
    }
  } catch {
    await fs.mkdir(assetsDir, { recursive: true });
  }
  
  await buildContent();
  await buildBackground();
  await copyIcons();
  await copyManifest();
  console.log('[extension-build] Extension build complete!');
}

main().catch((error) => {
  console.error('Extension build failed:', error);
  process.exit(1);
});

