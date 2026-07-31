# Glaze — Free Online Image Resizer & Converter

Resize, compress, and convert your images in seconds — completely free and fully private. All processing happens in your browser; your files are never uploaded to a server.

## Features

- **Resize Images Instantly** — Change dimensions by pixels, percentage, fit-within-box, or scale to original
- **Fit / Fill & Crop / Stretch** — Choose how images adapt to exact target dimensions
- **Convert Any Format** — JPG, PNG, WebP, and PDF output
- **Smart Compression** — Adjustable quality slider for JPG and WebP
- **Batch Processing** — Upload multiple images, download all as ZIP
- **PDF Page Extraction** — Drop a PDF to extract its pages as images
- **Image to PDF** — Convert images into individual PDF files
- **100% Private** — All processing happens in your browser; nothing is uploaded to a server
- **Light/Dark Theme** — Persists your choice across visits
- **Responsive Design** — Works on mobile, tablet, and desktop

## Getting Started

### Quick Start

Open `index.html` directly in a modern browser (Chrome, Edge, Firefox, Safari), or serve it locally:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000/`.

### Build from Source

```bash
npm install
npm run build
```

This bundles the dependencies (JSZip, jsPDF, PDF.js) into local assets. The `index.html` file loads `assets/app.js` and `assets/pdf.worker.min.mjs`.

### Run Tests

```bash
npm test
```

## Supported Formats

| Input | Output |
|-------|--------|
| JPG/JPEG | JPG, PNG, WebP, PDF |
| PNG | JPG, PNG, WebP, PDF |
| WebP | JPG, PNG, WebP, PDF |
| GIF | JPG, PNG, WebP, PDF (flattened — animation is not preserved) |
| PDF | JPG, PNG, WebP (one image per page) |

## Limits

| Limit | Value |
|-------|-------|
| Maximum files per batch | 50 |
| Maximum size per file | 100 MB |
| Maximum total batch size | 500 MB |
| Maximum output dimension per side | 12,000 px |
| Maximum output megapixels | 40 MP |
| Maximum PDF pages | 100 |

## Project Structure

```
index.html          — UI markup, styles, and layout
src/core.js         — Pure functions: limits, resize, naming, validation
src/app.js          — Application logic: UI, processing, downloads
tests/core.test.js  — Unit tests for core functions
scripts/build.mjs   — esbuild bundler config
```

## Browser Support

- Chrome / Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers with Canvas and ES2020 support

## Security

- PDF.js is loaded with `isEvalSupported: false` to prevent malicious PDF execution
- All dependencies are bundled locally from npm, eliminating CDN supply-chain risk
- Processing limits prevent memory exhaustion from extreme inputs
- No file data leaves the browser

## License

This project uses:
- [JSZip](https://stuk.github.io/jszip/) — MIT License
- [jsPDF](https://github.com/parallax/jsPDF) — MIT License
- [PDF.js](https://mozilla.github.io/pdf.js/) — Apache License 2.0
