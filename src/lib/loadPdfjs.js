// One place that loads pdf.js, so the reference-pane viewer and the upload
// check always use the same build and worker.
//
// We use pdf.js's "legacy" build and worker: it bundles its own polyfills
// (Promise.withResolvers, AbortSignal.any, ...) that the modern build assumes,
// which is what lets PDFs open on iPadOS 16 and early iPadOS 17 as well as
// current browsers. Even the legacy build needs Safari 16.4+ though — it uses
// class static blocks, which older browsers can't even parse — so on those
// (e.g. iPads stuck on iPadOS 15) we detect it up front and show a clear
// message instead of a generic failure.

let cachedSupport = null;

export function browserCanOpenPdfs() {
  if (cachedSupport !== null) return cachedSupport;
  try {
    // Parses only if the browser understands class static blocks — the
    // newest syntax the pdf.js worker relies on.
    new Function("class A { static { this.x = 1; } } return A.x;")();
    cachedSupport = true;
  } catch (err) {
    cachedSupport = false;
  }
  return cachedSupport;
}

export const PDF_UNSUPPORTED_MESSAGE =
  "This device's browser is too old to open PDFs here. Upload the worksheet as an image instead (a screenshot works), or open the board on a newer device.";

export async function loadPdfjs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
  return pdfjsLib;
}
