import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDrawPlan,
  computeTargetSize,
  makeUniqueName,
  renameExtension,
  validateCanvasSize,
  parseTargetBytes,
  encodeWithQualityBudget,
  nextBudgetScaleSize
} from '../src/core.js';

test('renames extensions and strips path components', () => {
  assert.equal(renameExtension('folder\\photo.old.jpg', 'webp'), 'photo.old.webp');
  assert.equal(renameExtension('document.pdf', 'png', 3), 'document-page-3.png');
});

test('allocates case-insensitive unique output names', () => {
  const used = new Set();
  assert.equal(makeUniqueName('photo.jpg', used), 'photo.jpg');
  assert.equal(makeUniqueName('PHOTO.jpg', used), 'PHOTO-2.jpg');
  assert.equal(makeUniqueName('photo.jpg', used), 'photo-3.jpg');
});

test('fits mixed images inside maximum dimensions without enlargement', () => {
  const settings = { sizeMode: 'maximum', width: 1920, height: 1080, neverEnlarge: true };
  assert.deepEqual(computeTargetSize(4000, 3000, settings), { width: 1440, height: 1080 });
  assert.deepEqual(computeTargetSize(800, 600, settings), { width: 800, height: 600 });
});

test('preserves aspect ratio for exact width', () => {
  const settings = { sizeMode: 'pixels', width: 1000, height: null, aspectLock: true, neverEnlarge: false };
  assert.deepEqual(computeTargetSize(4000, 3000, settings), { width: 1000, height: 750 });
});

test('computes centered fit and fill plans', () => {
  const fit = computeDrawPlan(1600, 900, 1000, 1000, 'fit');
  assert.equal(fit.dy, 218.75);
  assert.equal(fit.dw, 1000);
  const fill = computeDrawPlan(1600, 900, 1000, 1000, 'fill');
  assert.equal(fill.sw, 900);
  assert.equal(fill.sx, 350);
});

test('rejects unsafe canvas dimensions', () => {
  assert.throws(() => validateCanvasSize(12001, 100), /per side/);
  assert.throws(() => validateCanvasSize(10000, 10000), /megapixels/);
  assert.doesNotThrow(() => validateCanvasSize(4000, 3000));
});

test('respects percentage mode', () => {
  const settings = { sizeMode: 'percentage', percentage: 50, neverEnlarge: false };
  assert.deepEqual(computeTargetSize(1000, 800, settings), { width: 500, height: 400 });
});

test('percentage mode scales proportionally', () => {
  const settings = { sizeMode: 'percentage', percentage: 75, neverEnlarge: false };
  assert.deepEqual(computeTargetSize(1000, 800, settings), { width: 750, height: 600 });
});

test('never-enlarge prevents pixel upscaling', () => {
  const settings = { sizeMode: 'pixels', width: 5000, height: 5000, aspectLock: false, neverEnlarge: true };
  assert.deepEqual(computeTargetSize(2000, 1000, settings), { width: 2000, height: 1000 });
});

test('returns original dimensions for original mode', () => {
  const settings = { sizeMode: 'original' };
  assert.deepEqual(computeTargetSize(3000, 2000, settings), { width: 3000, height: 2000 });
});

test('strips complex file extensions correctly', () => {
  assert.equal(renameExtension('my.photo.2024.jpg', 'webp'), 'my.photo.2024.webp');
  assert.equal(renameExtension('noextension', 'png'), 'noextension.png');
});

test('fill plan centers crop for landscape target', () => {
  const plan = computeDrawPlan(3000, 1000, 1000, 1000, 'fill');
  assert.equal(plan.sw, 1000);
  assert.equal(plan.sx, 1000);
  assert.equal(plan.sh, 1000);
  assert.equal(plan.dy, 0);
});

test('fit plan centers content for portrait target', () => {
  const plan = computeDrawPlan(1600, 900, 500, 1000, 'fit');
  assert.equal(plan.dw, 500);
  assert.equal(plan.dh, 281.25);
  assert.equal(plan.dx, 0);
  assert.equal(Math.round(plan.dy), 359);
});

test('parseTargetBytes converts KB to bytes', () => {
  assert.equal(parseTargetBytes(1, 'KB'), 1024);
  assert.equal(parseTargetBytes(100, 'KB'), 102400);
  assert.equal(parseTargetBytes(200.5, 'KB'), 205312);
});

test('parseTargetBytes converts MB to bytes', () => {
  assert.equal(parseTargetBytes(1, 'MB'), 1048576);
  assert.equal(parseTargetBytes(0.5, 'MB'), 524288);
  assert.equal(parseTargetBytes(50, 'MB'), 52428800);
});

test('parseTargetBytes rejects invalid inputs', () => {
  assert.throws(() => parseTargetBytes(0, 'KB'), /positive/);
  assert.throws(() => parseTargetBytes(-1, 'KB'), /positive/);
  assert.throws(() => parseTargetBytes('abc', 'KB'), /positive/);
  assert.throws(() => parseTargetBytes(0.5, 'KB'), /at least 1 KB/);
  assert.throws(() => parseTargetBytes(51, 'MB'), /50 MB/);
});

test('nextBudgetScaleSize reduces dimensions by factor', () => {
  assert.deepEqual(nextBudgetScaleSize(1000, 800, 0.9), { width: 900, height: 720 });
  assert.deepEqual(nextBudgetScaleSize(100, 100, 0.5), { width: 50, height: 50 });
  assert.deepEqual(nextBudgetScaleSize(1, 1, 0.9), { width: 1, height: 1 });
});

test('encodeWithQualityBudget returns high quality blob when already under budget', async () => {
  let calls = 0;
  const encode = async (q) => {
    calls++;
    return new Blob(['x'.repeat(100)], { type: 'image/jpeg' });
  };
  const result = await encodeWithQualityBudget(encode, 10000, { minQ: 0.1, maxQ: 0.95, steps: 8 });
  assert.ok(result.metBudget);
  assert.equal(result.quality, 0.95);
  assert.equal(calls, 1);
});

test('encodeWithQualityBudget binary searches quality', async () => {
  let calls = 0;
  const encode = async (q) => {
    calls++;
    // Size increases with quality (matches real JPEG behavior)
    const size = Math.round(2000 * q);
    return new Blob(['x'.repeat(size)], { type: 'image/jpeg' });
  };
  const result = await encodeWithQualityBudget(encode, 1000, { minQ: 0.1, maxQ: 0.95, steps: 8 });
  assert.ok(calls > 1 && calls <= 9);
  assert.ok(result.quality >= 0.1 && result.quality <= 0.95);
});

test('encodeWithQualityBudget returns best effort at minQ when over budget', async () => {
  const encode = async (q) => {
    // Always return a large blob
    return new Blob(['x'.repeat(100000)], { type: 'image/jpeg' });
  };
  const result = await encodeWithQualityBudget(encode, 1000, { minQ: 0.1, maxQ: 0.95, steps: 8 });
  assert.ok(!result.metBudget);
  assert.equal(result.quality, 0.1);
});
