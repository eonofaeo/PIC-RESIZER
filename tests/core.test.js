import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDrawPlan,
  computeTargetSize,
  makeUniqueName,
  renameExtension,
  validateCanvasSize
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
