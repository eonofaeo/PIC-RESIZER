# OKSS — Implementation Plan

**Glaze feature pack:** Passport presets · Target file size (KB/MB) · Background remover

Status: active · Scope: `src/`, `index.html`, tests, rebuild `assets/`

---

## Goals

1. **Passport size presets** — one-click exact dimensions for common passport / ID photos, with crop-to-fill so the output matches the official frame.
2. **Custom file-size target** — user picks a target in KB or MB; the app compresses (and scales down if needed) until the blob is at or under that budget.
3. **Background remover** — optional, 100% in-browser; replace with white (passport-friendly), transparent, or a custom color.

All processing stays on-device. No uploads.

---

## Architecture

```
index.html          UI: presets, File size mode, BG toggle + fill
src/core.js         Pure helpers: target bytes, quality binary-search bounds
src/bg.js           Dynamic wrapper around @imgly/background-removal
src/app.js          Wire settings → draw → optional BG → encode-to-budget
tests/core.test.js  Unit tests for new helpers
```

### Data flow (per image)

1. Read settings (`sizeMode`, dimensions / %, target bytes, `removeBg`, `bgFill`).
2. If `removeBg`: run client model → canvas/ImageBitmap with alpha.
3. Compute pixel target (`computeTargetSize`); passport presets force `fitBehavior: 'fill'`.
4. Draw onto output canvas (white fill under JPG/PDF; respect transparency for PNG/WebP).
5. If target bytes set: binary-search JPEG/WebP quality; if still over budget at floor quality, iteratively scale canvas down ~10% and retry.
6. Emit blob + preview.

---

## Feature specs

### A. Passport presets

| Label | Size (px @ ~300 DPI) | Notes |
|-------|----------------------|--------|
| US Passport / Visa | 600 × 600 | 2″ × 2″ |
| ICAO / EU / India style | 413 × 531 | 35 × 45 mm |
| UK Passport | 413 × 531 | same frame |
| Soft copy (web) | 350 × 350 | lighter ID thumb |

- Selecting a passport preset switches Size → Pixels, unlocks aspect, sets W×H, and marks `fitBehavior = 'fill'`.
- Hint under presets: “Passport presets crop to fill the frame.”

### B. Target file size (KB / MB)

- New size-seg mode: **File size** (orthogonal to pixel resize: dimensions still come from Original / Percent / Pixels when those are selected).
  - **Revised UX (clearer):** keep size modes as today; add a **Target size** control group next to Quality:
    - Toggle “Limit file size”
    - Number input + unit select (`KB` | `MB`)
    - Hint: “Quality auto-adjusts. Prefer JPG or WebP.”
- Pure helper: `parseTargetBytes(value, unit)` → integer bytes (min 1 KB, max 50 MB).
- Encoder: `encodeCanvasToBudget(canvas, mime, targetBytes, { minQ, maxQ })`.
- PNG + target size: auto-suggest switch to JPG/WebP in hint; if user stays on PNG, only scale-down path applies (no quality knob).
- PDF path: bake JPEG pages with budgeted quality first.

### C. Background remover

- Dependency: `@imgly/background-removal` (WASM/ONNX, downloaded on first use).
- Dynamic `import()` from `src/bg.js` so cold load stays light.
- UI: switch “Remove background” + fill select: White | Transparent | Custom (color input).
- Passport workflow tip: Remove BG + White fill + US/ICAO preset.
- Status text: “Removing background…” then “Processing n of m…”.
- Fail soft: toast + continue without BG if model fails.

---

## UI layout

```
Adjust deck
├─ Size (Original | Percent | Pixels) + presets (+ passport options)
├─ Format
├─ Quality  +  Target size (optional KB/MB)
└─ Tools: Remove background · Fill color
```

Deck grid → 2×2 on desktop (`1fr 1fr` / tools span), stacked on mobile. Match existing glass tokens; no new card chrome.

---

## Implementation order

1. Write this plan (`OKSS.MD`) ✓
2. Core helpers + tests (`parseTargetBytes`, encode budget loop helpers)
3. Passport options in `presetSelect` + fill behavior on preset apply
4. Target-size UI + encode-to-budget in image/PDF pipelines
5. BG module + UI + pre-process hook
6. `npm install` · `npm run check` · push when asked

---

## Acceptance checks

- [ ] Passport preset yields exact W×H and crops (fill), not letterbox.
- [ ] Target e.g. `200 KB` → output `≤ 200 KB` (or best-effort toast if impossible at min scale).
- [ ] BG remove → white fill usable for passport JPG; transparent for PNG.
- [ ] Existing Original / Percent / Pixels / formats still work.
- [ ] `npm test` and `npm run build` pass; `node_modules` stays gitignored.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| BG model large first download | Dynamic import + status copy |
| Target size impossible (tiny budget, huge PNG) | Scale-down loop + toast with actual size |
| Bundle size | Keep BG out of critical path; minify build |
| Stretch vs passport crop | Presets set `fill`; general pixels keep stretch/lock as today |

---

## Out of scope (later)

- Server-side BG / paid APIs
- Multi-face detection / official ICAO compliance check
- Exact byte match (only ≤ target)
