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
