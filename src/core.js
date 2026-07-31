export const LIMITS = Object.freeze({
  maxFiles: 50,
  maxFileBytes: 100 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxPdfPages: 100,
  maxSide: 12000,
  maxPixels: 40_000_000
});

export function renameExtension(filename, extension, pageNumber) {
  const safeName = String(filename).split(/[\\/]/).pop() || 'output';
  const base = safeName.replace(/\.[^/.]+$/, '') || 'output';
  const suffix = pageNumber ? `-page-${pageNumber}` : '';
  return `${base}${suffix}.${extension}`;
}

export function makeUniqueName(filename, usedNames) {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  let candidate = filename;
  let counter = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}-${counter}${extension}`;
    counter += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export function computeTargetSize(naturalWidth, naturalHeight, settings) {
  const nw = Number(naturalWidth) || 1;
  const nh = Number(naturalHeight) || 1;

  if (settings.sizeMode === 'percentage') {
    const scale = settings.percentage / 100;
    return { width: Math.max(1, Math.round(nw * scale)), height: Math.max(1, Math.round(nh * scale)) };
  }

  if (settings.sizeMode === 'maximum') {
    const maxWidth = settings.width || nw;
    const maxHeight = settings.height || nh;
    let scale = Math.min(maxWidth / nw, maxHeight / nh);
    if (settings.neverEnlarge) scale = Math.min(1, scale);
    return { width: Math.max(1, Math.round(nw * scale)), height: Math.max(1, Math.round(nh * scale)) };
  }

  if (settings.sizeMode === 'pixels') {
    let width = settings.width || nw;
    let height = settings.height || nh;
    if (settings.aspectLock) {
      if (settings.width) height = Math.round(width * nh / nw);
      else if (settings.height) width = Math.round(height * nw / nh);
    }
    if (settings.neverEnlarge) {
      const scale = Math.min(1, width / nw, height / nh);
      width = Math.round(nw * scale);
      height = Math.round(nh * scale);
    }
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }

  return { width: Math.round(nw), height: Math.round(nh) };
}

export function computeDrawPlan(sourceWidth, sourceHeight, targetWidth, targetHeight, behavior) {
  if (behavior === 'stretch') {
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: 0, dy: 0, dw: targetWidth, dh: targetHeight };
  }

  const scale = behavior === 'fill'
    ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;

  if (behavior === 'fill') {
    const sourceCropWidth = targetWidth / scale;
    const sourceCropHeight = targetHeight / scale;
    return {
      sx: (sourceWidth - sourceCropWidth) / 2,
      sy: (sourceHeight - sourceCropHeight) / 2,
      sw: sourceCropWidth,
      sh: sourceCropHeight,
      dx: 0,
      dy: 0,
      dw: targetWidth,
      dh: targetHeight
    };
  }

  return {
    sx: 0,
    sy: 0,
    sw: sourceWidth,
    sh: sourceHeight,
    dx: (targetWidth - drawnWidth) / 2,
    dy: (targetHeight - drawnHeight) / 2,
    dw: drawnWidth,
    dh: drawnHeight
  };
}

export function validateCanvasSize(width, height, limits = LIMITS) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('Output dimensions must be positive numbers.');
  }
  if (width > limits.maxSide || height > limits.maxSide) {
    throw new Error(`Output dimensions cannot exceed ${limits.maxSide.toLocaleString()} px per side.`);
  }
  if (width * height > limits.maxPixels) {
    throw new Error(`Output cannot exceed ${(limits.maxPixels / 1_000_000).toFixed(0)} megapixels.`);
  }
}

/** Convert a user-facing size + unit into a byte budget. */
export function parseTargetBytes(value, unit = 'KB') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('Target file size must be a positive number.');
  }
  const u = String(unit || 'KB').toUpperCase();
  const bytes = u === 'MB' ? Math.round(n * 1024 * 1024) : Math.round(n * 1024);
  if (bytes < 1024) throw new Error('Target file size must be at least 1 KB.');
  if (bytes > 50 * 1024 * 1024) throw new Error('Target file size cannot exceed 50 MB.');
  return bytes;
}

/**
 * Binary-search a quality in [minQ, maxQ] so encoded size ≤ targetBytes.
 * `encode(quality01)` must return a Promise<Blob|null>.
 * Returns { blob, quality, metBudget }.
 */
export async function encodeWithQualityBudget(encode, targetBytes, { minQ = 0.1, maxQ = 0.95, steps = 8 } = {}) {
  let lo = minQ;
  let hi = maxQ;
  let best = null;
  let bestQ = minQ;

  const highBlob = await encode(hi);
  if (highBlob && highBlob.size <= targetBytes) {
    return { blob: highBlob, quality: hi, metBudget: true };
  }

  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    const blob = await encode(mid);
    if (!blob) continue;
    if (blob.size <= targetBytes) {
      best = blob;
      bestQ = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (!best) {
    best = await encode(minQ);
    bestQ = minQ;
  }

  return {
    blob: best,
    quality: bestQ,
    metBudget: Boolean(best && best.size <= targetBytes)
  };
}

/** Next canvas size when quality alone cannot hit the budget (~10% smaller). */
export function nextBudgetScaleSize(width, height, factor = 0.9) {
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor))
  };
}

export const PASSPORT_PRESETS = Object.freeze([
  { id: 'us-passport', label: 'US Passport / Visa — 600 × 600', width: 600, height: 600, fit: 'fill' },
  { id: 'icao-35x45', label: 'ICAO / EU / India — 413 × 531', width: 413, height: 531, fit: 'fill' },
  { id: 'passport-soft', label: 'Passport Soft Copy — 350 × 350', width: 350, height: 350, fit: 'fill' }
]);
