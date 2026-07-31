/**
 * Client-side background removal via @imgly/background-removal (lazy-loaded).
 * Loaded from a CDN ESM build so cold start stays light and WASM/ONNX models
 * are fetched from IMG.LY on first use only.
 * Returns a PNG Blob with alpha, or throws on failure.
 */

const PACKAGE_VERSION = '1.7.0';

// Full URL so esbuild leaves this as a true runtime dynamic import (not bundled).
const MODULE_URL = `https://cdn.jsdelivr.net/npm/@imgly/background-removal@${PACKAGE_VERSION}/+esm`;

let removalPromise = null;

async function getRemover() {
  if (!removalPromise) {
    removalPromise = import(MODULE_URL).then((mod) => {
      // Package exports both default and named removeBackground
      return mod.removeBackground || mod.default;
    });
  }
  return removalPromise;
}

export async function removeImageBackground(source, onProgress) {
  const removeBackground = await getRemover();
  if (typeof removeBackground !== 'function') {
    throw new Error('Background removal module did not export removeBackground.');
  }
  return removeBackground(source, {
    publicPath: `https://staticimgly.com/@imgly/background-removal-data/${PACKAGE_VERSION}/dist/`,
    progress: (key, current, total) => {
      if (typeof onProgress === 'function' && total) {
        onProgress(key, current, total);
      }
    }
  });
}
