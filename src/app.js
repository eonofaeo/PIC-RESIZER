import {
  LIMITS, renameExtension, makeUniqueName, computeTargetSize,
  computeDrawPlan, validateCanvasSize, parseTargetBytes,
  encodeWithQualityBudget, nextBudgetScaleSize
} from './core.js';

import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import { removeImageBackground } from './bg.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const themeToggle = $('themeToggle');
const dropzone = $('dropzone');
const fileInput = $('fileInput');
const browseBtn = $('browseBtn');
const fileListEl = $('fileList');
const deck = $('deck');
const fileCountLabel = $('fileCountLabel');
const processBtn = $('processBtn');
const processLabel = $('processLabel');
const statusText = $('statusText');
const resultsEl = $('results');
const resultGrid = $('resultGrid');
const resultsSub = $('resultsSub');
const stepsIndicator = $('stepsIndicator');

let files = [];
let results = [];
let processingId = 0;
let isProcessing = false;

function getSettings() {
  const targetSizeEnabled = $('targetSizeEnabled').checked;
  let targetBytes = null;
  if (targetSizeEnabled) {
    const val = parseInt($('targetSizeValue').value, 10);
    const unit = $('targetSizeUnit').value;
    try {
      targetBytes = parseTargetBytes(val, unit);
    } catch (e) {
      targetBytes = null;
    }
  }
  const presetSelect = $('presetSelect');
  const presetFit = presetSelect.dataset?.fitBehavior || 'stretch';
  return {
    sizeMode: document.querySelector('.seg-btn.active')?.dataset.mode || 'original',
    percentage: parseInt($('pctRange').value, 10) || 100,
    width: $('pxWidth').value ? parseInt($('pxWidth').value, 10) : null,
    height: $('pxHeight').value ? parseInt($('pxHeight').value, 10) : null,
    aspectLock: $('aspectLock').checked,
    neverEnlarge: false,
    format: $('formatSelect').value,
    quality: parseInt($('qualityRange').value, 10) || 85,
    fitBehavior: presetFit,
    targetEnabled: targetSizeEnabled,
    targetBytes,
    removeBg: $('removeBgEnabled').checked,
    bgFillMode: $('bgFillMode').value,
    bgFillColor: $('bgFillColor').value
  };
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast glass';
  t.textContent = msg;
  $('toastWrap').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function updateSteps() {
  const pills = stepsIndicator.querySelectorAll('.step-pill');
  let active = 1;
  if (results.length) active = 3;
  else if (files.length) active = 2;
  pills.forEach(p => p.classList.toggle('active', parseInt(p.dataset.step, 10) <= active));
}

function updateDeckVisibility() {
  deck.hidden = files.length === 0;
  fileCountLabel.textContent = files.length + (files.length === 1 ? ' file' : ' files');
}

function updateFormatHint() {
  const settings = getSettings();
  const hasPdf = files.some(f => f.isPdf);
  const formatHint = $('formatHint');
  if (hasPdf && (settings.format === 'keep' || settings.format === 'pdf')) {
    formatHint.textContent = 'PDFs are extracted as JPG image pages.';
  } else if (hasPdf) {
    formatHint.textContent = 'PDFs are extracted as ' + settings.format.toUpperCase() + ' image pages.';
  } else if (settings.format === 'keep') {
    formatHint.textContent = 'Each file exports in its current format.';
  } else if (settings.format === 'pdf') {
    formatHint.textContent = 'Each image becomes its own single-page PDF.';
  } else {
    formatHint.textContent = 'All images export as ' + settings.format.toUpperCase() + '.';
  }
}

function updateQualityUI() {
  const settings = getSettings();
  const disabled = settings.format === 'png';
  const targetMode = settings.targetEnabled;
  $('qualityRange').disabled = disabled || targetMode;
  if (targetMode) {
    $('qualityHint').textContent = 'Quality auto-adjusts to meet target size. Prefer JPG or WebP.';
  } else if (disabled) {
    $('qualityHint').textContent = 'PNG is lossless — quality doesn\u2019t apply here.';
  } else {
    $('qualityHint').textContent = 'Lower quality means a smaller file.';
  }
}

function updateProcessLabel() {
  if (isProcessing) return;
  processBtn.disabled = files.length === 0;
  processLabel.textContent = files.length
    ? ('Process ' + files.length + (files.length === 1 ? ' file' : ' files'))
    : 'Drop a file to begin';
}

function guessFormatFromMime(mime) {
  if (!mime) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'png';
  return 'jpg';
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

function disposeFile(fileObj) {
  if (fileObj.thumbUrl && fileObj.thumbUrl.startsWith('blob:')) {
    URL.revokeObjectURL(fileObj.thumbUrl);
  }
}

function disposeResult(result) {
  if (result.url && result.url.startsWith('blob:')) URL.revokeObjectURL(result.url);
  if (result.previewUrl && result.previewUrl.startsWith('blob:') && result.previewUrl !== result.url) {
    URL.revokeObjectURL(result.previewUrl);
  }
}

function disposeAllResults() {
  results.forEach(disposeResult);
  results = [];
}

function invalidateResults() {
  disposeAllResults();
  resultsEl.hidden = true;
  resultGrid.innerHTML = '';
  updateSteps();
}

function removeFile(id) {
  const idx = files.findIndex(f => f.id === id);
  if (idx !== -1) {
    disposeFile(files[idx]);
    files.splice(idx, 1);
  }
  invalidateResults();
  renderFileList();
  updateDeckVisibility();
  updateFormatHint();
  updateProcessLabel();
}

function clearAll() {
  files.forEach(disposeFile);
  files = [];
  disposeAllResults();
  renderFileList();
  resultsEl.hidden = true;
  resultGrid.innerHTML = '';
  updateSteps();
  updateDeckVisibility();
  updateFormatHint();
  updateProcessLabel();
}

function renderFileList() {
  if (!files.length) { fileListEl.innerHTML = ''; return; }
  let html = '';
  files.forEach(fo => {
    const dims = fo.isPdf ? 'PDF document' : (fo.naturalWidth + ' × ' + fo.naturalHeight);
    const thumb = fo.isPdf
      ? '<div class="file-thumb pdf"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></div>'
      : '<img class="file-thumb" src="' + fo.thumbUrl + '" alt="" />';
    html += '<div class="file-row glass" data-id="' + fo.id + '">' +
      thumb +
      '<div class="file-meta">' +
        '<div class="file-name">' + escapeHtml(fo.name) + '</div>' +
        '<div class="file-sub">' + dims + ' · ' + formatBytes(fo.size) + '</div>' +
      '</div>' +
      '<button type="button" class="file-remove" aria-label="Remove ' + escapeHtml(fo.name) + '" data-remove="' + fo.id + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button>' +
    '</div>';
  });
  html += '<button type="button" class="clear-all" id="clearAllBtn">Clear all</button>';
  fileListEl.innerHTML = html;
  const clearBtn = $('clearAllBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearAll);
  fileListEl.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => removeFile(btn.getAttribute('data-remove')));
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function addFiles(fileList) {
  const list = Array.from(fileList || []);
  const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  let totalBytes = files.reduce((a, f) => a + f.size, 0);

  if (files.length + list.length > LIMITS.maxFiles) {
    showToast('You can add up to ' + LIMITS.maxFiles + ' files at once.');
    return;
  }

  for (const file of list) {
    const typeOk = ACCEPTED.includes(file.type) || /\.(jpe?g|png|webp|gif|pdf)$/i.test(file.name);
    if (!typeOk) {
      showToast('"' + file.name + '" isn\'t supported. Try JPG, PNG, WebP, GIF, or PDF.');
      continue;
    }
    if (file.size > LIMITS.maxFileBytes) {
      showToast('"' + file.name + '" exceeds the ' + formatBytes(LIMITS.maxFileBytes) + ' per-file limit.');
      continue;
    }
    totalBytes += file.size;
    if (totalBytes > LIMITS.maxTotalBytes) {
      showToast('Total file size would exceed ' + formatBytes(LIMITS.maxTotalBytes) + '. Remove some files.');
      break;
    }

    const id = uid();
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const fo = {
      id, file, name: file.name, size: file.size,
      type: file.type || (isPdf ? 'application/pdf' : ''),
      isPdf, naturalWidth: 0, naturalHeight: 0, imgEl: null, thumbUrl: null
    };
    if (!isPdf) {
      try {
        const url = URL.createObjectURL(file);
        const img = await loadImage(url);
        fo.imgEl = img;
        fo.naturalWidth = img.naturalWidth;
        fo.naturalHeight = img.naturalHeight;
        fo.thumbUrl = url;
      } catch (e) {
        showToast('Couldn\'t read "' + file.name + '". Skipping it.');
        continue;
      }
    }
    files.push(fo);
  }
  invalidateResults();
  renderFileList();
  updateSteps();
  updateDeckVisibility();
  updateFormatHint();
  updateProcessLabel();
}

/**
 * Encode a canvas to a byte budget.
 * - JPG/WebP: binary-search quality, then scale down if still over budget.
 * - PNG: no quality knob — single encode, then scale down only.
 * Cleans up all working canvases. Returns { blob, metBudget }.
 */
async function encodeCanvasToBudget(canvas, mime, effectiveFmt, targetBytes, fitBehavior, sourceW, sourceH) {
  const minQ = 0.1;
  const maxQ = 0.95;
  const isPng = effectiveFmt === 'png';

  let blob;
  let metBudget = false;

  // Phase 1: Quality search (skip for PNG — no quality knob, only scale-down applies)
  if (isPng) {
    blob = await new Promise(res => canvas.toBlob(res, mime));
    metBudget = Boolean(blob && blob.size <= targetBytes);
  } else {
    const encode = (q) => new Promise(res => canvas.toBlob(res, mime, q));
    const result = await encodeWithQualityBudget(encode, targetBytes, { minQ, maxQ });
    blob = result.blob;
    metBudget = result.metBudget;
  }

  // Phase 2: Scale down iteratively if still over budget
  if (!metBudget && blob) {
    let curW = canvas.width;
    let curH = canvas.height;
    let curCanvas = canvas;
    for (let attempt = 0; attempt < 8 && curW > 10 && curH > 10; attempt++) {
      const next = nextBudgetScaleSize(curW, curH, 0.9);
      curW = next.width;
      curH = next.height;
      if (curW < 10 || curH < 10) break;
      validateCanvasSize(curW, curH);
      const newCanvas = document.createElement('canvas');
      newCanvas.width = curW;
      newCanvas.height = curH;
      const newCtx = newCanvas.getContext('2d');
      if (effectiveFmt === 'jpg' || effectiveFmt === 'pdf') {
        newCtx.fillStyle = '#ffffff';
        newCtx.fillRect(0, 0, curW, curH);
      }
      const newDrawPlan = computeDrawPlan(sourceW, sourceH, curW, curH, fitBehavior);
      newCtx.drawImage(
        curCanvas,
        newDrawPlan.sx, newDrawPlan.sy, newDrawPlan.sw, newDrawPlan.sh,
        newDrawPlan.dx, newDrawPlan.dy, newDrawPlan.dw, newDrawPlan.dh
      );
      curCanvas.width = 0;
      curCanvas.height = 0;
      curCanvas = newCanvas;
      if (isPng) {
        blob = await new Promise(res => curCanvas.toBlob(res, mime));
        metBudget = Boolean(blob && blob.size <= targetBytes);
      } else {
        const retryResult = await encodeWithQualityBudget(
          (q) => new Promise(res => curCanvas.toBlob(res, mime, q)),
          targetBytes,
          { minQ, maxQ }
        );
        blob = retryResult.blob;
        metBudget = retryResult.metBudget;
      }
      if (metBudget) break;
    }
    curCanvas.width = 0;
    curCanvas.height = 0;
  } else {
    canvas.width = 0;
    canvas.height = 0;
  }

  return { blob, metBudget };
}

async function processSingleImage(fo, settings, jobId) {
  if (processingId !== jobId) return null;

  let img = fo.imgEl;
  const naturalWidth = fo.naturalWidth;
  const naturalHeight = fo.naturalHeight;

  // Background removal (pre-process)
  if (settings.removeBg) {
    try {
      statusText.textContent = 'Removing background…';
      const bgBlob = await removeImageBackground(fo.file, (key, current, total) => {
        if (processingId !== jobId) return;
        statusText.textContent = 'Removing background… ' + Math.round((current / total) * 100) + '%';
      });
      const bgUrl = URL.createObjectURL(bgBlob);
      const bgImg = await loadImage(bgUrl);
      URL.revokeObjectURL(bgUrl);
      img = bgImg;
    } catch (e) {
      showToast('Background removal failed for "' + fo.name + '". Continuing without it.');
    }
  }

  const target = computeTargetSize(naturalWidth, naturalHeight, settings);
  const w = target.width;
  const h = target.height;
  const effectiveFmt = settings.format === 'keep' ? guessFormatFromMime(fo.type) : settings.format;

  validateCanvasSize(w, h);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const drawPlan = computeDrawPlan(naturalWidth, naturalHeight, w, h, settings.fitBehavior);

  // Determine fill color for background
  let fillColor = '#ffffff';
  if (settings.removeBg && settings.bgFillMode) {
    if (settings.bgFillMode === 'transparent') {
      fillColor = null; // No fill, keep transparency
    } else if (settings.bgFillMode === 'custom') {
      fillColor = settings.bgFillColor;
    }
  }

  // Fill background if needed (for JPG/PDF or when explicit fill color)
  if (effectiveFmt === 'jpg' || effectiveFmt === 'pdf' || fillColor) {
    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, w, h);
    } else if (effectiveFmt === 'jpg' || effectiveFmt === 'pdf') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
  }

  ctx.drawImage(
    img,
    drawPlan.sx, drawPlan.sy, drawPlan.sw, drawPlan.sh,
    drawPlan.dx, drawPlan.dy, drawPlan.dw, drawPlan.dh
  );

  if (effectiveFmt === 'pdf') {
    const qArg = settings.quality / 100;
    const jpgUrl = canvas.toDataURL('image/jpeg', qArg);
    const orientation = w >= h ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [w, h] });
    pdf.addImage(jpgUrl, 'JPEG', 0, 0, w, h);
    const blob = pdf.output('blob');
    canvas.width = 0;
    canvas.height = 0;
    return {
      name: renameExtension(fo.name, 'pdf'),
      blob, url: URL.createObjectURL(blob),
      previewUrl: jpgUrl,
      width: w, height: h,
      originalSize: fo.size, newSize: blob.size
    };
  }

  const mime = effectiveFmt === 'png' ? 'image/png' : effectiveFmt === 'webp' ? 'image/webp' : 'image/jpeg';

  let blob;
  if (settings.targetEnabled && settings.targetBytes) {
    const { blob: budgetBlob, metBudget } = await encodeCanvasToBudget(
      canvas, mime, effectiveFmt, settings.targetBytes, settings.fitBehavior, w, h
    );
    blob = budgetBlob;
    if (!metBudget && blob) {
      showToast('Could not reach target size for "' + fo.name + '". Best effort: ' + formatBytes(blob.size) + '.');
    }
  } else {
    const qArg = effectiveFmt === 'png' ? undefined : settings.quality / 100;
    blob = await new Promise(res => canvas.toBlob(res, mime, qArg));
    canvas.width = 0;
    canvas.height = 0;
  }

  if (!blob) throw new Error('Encoding failed');
  const url = URL.createObjectURL(blob);
  return {
    name: renameExtension(fo.name, effectiveFmt),
    blob, url, previewUrl: url,
    width: w, height: h,
    originalSize: fo.size, newSize: blob.size
  };
}

async function processSinglePdf(fo, settings, jobId) {
  if (processingId !== jobId) return [];
  const out = [];
  const buf = await fo.file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: buf,
    isEvalSupported: false
  });
  const pdfDoc = await loadingTask.promise;
  const effectiveFmt = (settings.format === 'keep' || settings.format === 'pdf') ? 'jpg' : settings.format;

  const totalPages = pdfDoc.numPages;
  if (totalPages > LIMITS.maxPdfPages) {
    throw new Error('PDF has ' + totalPages + ' pages. Max is ' + LIMITS.maxPdfPages + '.');
  }

  for (let i = 1; i <= totalPages; i++) {
    if (processingId !== jobId) break;

    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });

    let renderScale = 1;
    const maxDim = Math.max(settings.width || 0, settings.height || 0);
    if (maxDim > 0) {
      renderScale = Math.min(maxDim / viewport.width, maxDim / viewport.height, 2);
    }

    const scaledViewport = page.getViewport({ scale: renderScale });
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = Math.round(scaledViewport.width);
    renderCanvas.height = Math.round(scaledViewport.height);
    const rctx = renderCanvas.getContext('2d');
    await page.render({ canvasContext: rctx, viewport: scaledViewport }).promise;

    const target = computeTargetSize(renderCanvas.width, renderCanvas.height, settings);
    const w = target.width;
    const h = target.height;
    validateCanvasSize(w, h);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (effectiveFmt === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }

    const drawPlan = computeDrawPlan(renderCanvas.width, renderCanvas.height, w, h, settings.fitBehavior);
    ctx.drawImage(
      renderCanvas,
      drawPlan.sx, drawPlan.sy, drawPlan.sw, drawPlan.sh,
      drawPlan.dx, drawPlan.dy, drawPlan.dw, drawPlan.dh
    );

    renderCanvas.width = 0;
    renderCanvas.height = 0;

    const mime = effectiveFmt === 'png' ? 'image/png' : effectiveFmt === 'webp' ? 'image/webp' : 'image/jpeg';

    let blob;
    if (settings.targetEnabled && settings.targetBytes) {
      const { blob: budgetBlob, metBudget } = await encodeCanvasToBudget(
        canvas, mime, effectiveFmt, settings.targetBytes, settings.fitBehavior, w, h
      );
      blob = budgetBlob;
      if (!metBudget && blob) {
        showToast('Could not reach target size for page ' + i + ' of "' + fo.name + '". Best effort: ' + formatBytes(blob.size) + '.');
      }
    } else {
      const qArg = effectiveFmt === 'png' ? undefined : settings.quality / 100;
      blob = await new Promise(res => canvas.toBlob(res, mime, qArg));
      canvas.width = 0;
      canvas.height = 0;
    }

    if (!blob) throw new Error('Encoding failed for page ' + i);
    const url = URL.createObjectURL(blob);
    out.push({
      name: renameExtension(fo.name, effectiveFmt, totalPages > 1 ? i : null),
      blob, url, previewUrl: url,
      width: w, height: h,
      originalSize: 0,
      newSize: blob.size
    });
  }
  return out;
}

processBtn.addEventListener('click', async () => {
  if (isProcessing || files.length === 0) return;
  isProcessing = true;
  processingId++;
  const currentJobId = processingId;
  processBtn.classList.add('loading');
  processBtn.disabled = true;
  invalidateResults();
  results = [];

  const settings = getSettings();
  let done = 0;

  for (const fo of files) {
    if (processingId !== currentJobId) break;
    statusText.textContent = 'Processing ' + (done + 1) + ' of ' + files.length + '…';
    try {
      if (fo.isPdf) {
        const pages = await processSinglePdf(fo, settings, currentJobId);
        results = results.concat(pages);
      } else {
        const r = await processSingleImage(fo, settings, currentJobId);
        if (r) results.push(r);
      }
    } catch (err) {
      showToast('Something went wrong with "' + fo.name + '". ' + (err.message || 'Skipping it.'));
    }
    done++;
  }

  if (processingId === currentJobId) {
    isProcessing = false;
    processBtn.classList.remove('loading');
    statusText.textContent = '';
    updateProcessLabel();
    renderResults();
    updateSteps();
    if (results.length) {
      resultsEl.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start'
      });
    }
  }
});

function renderResults() {
  if (!results.length) { resultsEl.hidden = true; resultGrid.innerHTML = ''; return; }
  resultsEl.hidden = false;
  resultsSub.textContent = results.length + (results.length === 1 ? ' file ready' : ' files ready');
  let html = '';
  const usedNames = new Set();

  results.forEach(r => {
    const uniqueName = makeUniqueName(r.name, usedNames);
    r.name = uniqueName;

    let badge = '';
    if (r.originalSize > 0) {
      const delta = Math.round((1 - r.newSize / r.originalSize) * 100);
      if (delta > 0) badge = '<span class="badge">-' + delta + '%</span>';
      else if (delta < 0) badge = '<span class="badge">+' + Math.abs(delta) + '%</span>';
    }
    const sizeLine = r.originalSize > 0
      ? (formatBytes(r.originalSize) + ' → ' + formatBytes(r.newSize))
      : formatBytes(r.newSize);
    html += '<div class="result-card glass">' +
      '<img class="result-thumb" src="' + r.previewUrl + '" alt="" />' +
      '<div class="result-name">' + escapeHtml(r.name) + '</div>' +
      '<div class="result-size">' + sizeLine + badge + '</div>' +
      '<a class="result-dl" href="' + r.url + '" download="' + escapeHtml(r.name) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>' +
        'Download' +
      '</a>' +
    '</div>';
  });
  resultGrid.innerHTML = html;
}

$('startOverBtn').addEventListener('click', clearAll);

$('downloadAllBtn').addEventListener('click', async () => {
  if (!results.length) return;
  const btn = $('downloadAllBtn');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = 'Zipping…';
  try {
    const zip = new JSZip();
    const usedNames = new Set();
    results.forEach(r => {
      const uniqueName = makeUniqueName(r.name, usedNames);
      zip.file(uniqueName, r.blob);
    });
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'glaze-export.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    showToast('Could not build the zip file. Try downloading files individually.');
  }
  btn.innerHTML = originalHtml;
});

document.querySelectorAll('.faq-item').forEach(item => {
  const q = item.querySelector('.faq-q');
  const a = item.querySelector('.faq-a');
  q.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(other => {
      if (other !== item) {
        other.classList.remove('open');
        other.querySelector('.faq-a').style.maxHeight = null;
      }
    });
    if (isOpen) {
      item.classList.remove('open');
      a.style.maxHeight = null;
    } else {
      item.classList.add('open');
      a.style.maxHeight = a.scrollHeight + 'px';
    }
  });
});

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  addFiles(e.dataTransfer.files);
});
dropzone.addEventListener('mousemove', e => {
  const r = dropzone.getBoundingClientRect();
  dropzone.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
  dropzone.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
});
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  addFiles(e.target.files);
  fileInput.value = '';
});

const sizeSeg = $('sizeSeg');
const panels = { original: $('panelOriginal'), percentage: $('panelPercentage'), pixels: $('panelPixels') };
sizeSeg.addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  sizeSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  Object.keys(panels).forEach(k => panels[k].hidden = (k !== btn.dataset.mode));
  invalidateResults();
  updateProcessLabel();
});

$('pctRange').addEventListener('input', function () {
  $('pctVal').textContent = this.value;
  invalidateResults();
});

$('pxWidth').addEventListener('input', function () {
  const w = this.value ? parseInt(this.value, 10) : null;
  if ($('aspectLock').checked && w) {
    const ref = files[0];
    if (ref && ref.naturalWidth) {
      const h = Math.round(w * ref.naturalHeight / ref.naturalWidth);
      $('pxHeight').value = h;
    }
  }
  invalidateResults();
  updateProcessLabel();
});

$('pxHeight').addEventListener('input', function () {
  const h = this.value ? parseInt(this.value, 10) : null;
  if ($('aspectLock').checked && h) {
    const ref = files[0];
    if (ref && ref.naturalWidth) {
      const w = Math.round(h * ref.naturalWidth / ref.naturalHeight);
      $('pxWidth').value = w;
    }
  }
  invalidateResults();
  updateProcessLabel();
});

$('aspectLock').addEventListener('change', function () {
  if (this.checked) {
    const w = $('pxWidth').value ? parseInt($('pxWidth').value, 10) : null;
    const ref = files[0];
    if (w && ref && ref.naturalWidth) {
      const h = Math.round(w * ref.naturalHeight / ref.naturalWidth);
      $('pxHeight').value = h;
    }
  }
});

$('presetSelect').addEventListener('change', function () {
  if (!this.value) return;
  const parts = this.value.split(',').map(Number);
  const w = parts[0];
  const h = parts[1];
  const fit = parts[2] === 1 || this.value.includes(',fill') ? 'fill' : 'stretch';
  sizeSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'pixels'));
  Object.keys(panels).forEach(k => panels[k].hidden = (k !== 'pixels'));
  $('pxWidth').value = w;
  $('pxHeight').value = h;
  $('aspectLock').checked = false;
  // Store fitBehavior on the select for getSettings to pick up
  this.dataset.fitBehavior = fit;
  invalidateResults();
  updateProcessLabel();
});

$('formatSelect').addEventListener('change', () => {
  invalidateResults();
  updateFormatHint();
  updateQualityUI();
});

$('qualityRange').addEventListener('input', function () {
  $('qualityVal').textContent = this.value;
  invalidateResults();
});

$('targetSizeEnabled').addEventListener('change', function () {
  $('targetSizeRow').hidden = !this.checked;
  invalidateResults();
  updateQualityUI();
});

$('targetSizeValue').addEventListener('input', function () {
  invalidateResults();
});

$('targetSizeUnit').addEventListener('change', function () {
  invalidateResults();
});

$('removeBgEnabled').addEventListener('change', function () {
  $('bgFillWrap').hidden = !this.checked;
  invalidateResults();
});

$('bgFillMode').addEventListener('change', function () {
  $('bgFillColor').hidden = this.value !== 'custom';
  invalidateResults();
});

themeToggle.addEventListener('click', () => {
  const isDark = root.getAttribute('data-theme') === 'dark';
  root.setAttribute('data-theme', isDark ? 'light' : 'dark');
  themeToggle.setAttribute('aria-label', isDark ? 'Switch to dark mode' : 'Switch to light mode');
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
});

(function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    root.setAttribute('data-theme', saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    root.setAttribute('data-theme', 'dark');
  }
  const isDark = root.getAttribute('data-theme') === 'dark';
  themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
})();

updateSteps();
updateDeckVisibility();
updateFormatHint();
updateQualityUI();
updateProcessLabel();
