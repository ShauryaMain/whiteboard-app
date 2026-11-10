// Copies the pdf.js worker and the calculator's maths fonts out of
// node_modules into public/vendor, so the app serves them itself instead
// of loading them from unpkg.com (another site we'd have to trust).
// Runs on its own before `npm run dev` and `npm run build` (see package.json).

import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = (...p) => join(root, "node_modules", ...p);
const out = (...p) => join(root, "public", "vendor", ...p);

const pdfjs = JSON.parse(readFileSync(mod("pdfjs-dist", "package.json"), "utf8")).version;
mkdirSync(out("pdfjs", pdfjs), { recursive: true });
cpSync(mod("pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"), out("pdfjs", pdfjs, "pdf.worker.min.mjs"));

cpSync(mod("mathlive", "fonts"), out("mathlive", "fonts"), { recursive: true });

console.log(`vendor files ready (pdf.js ${pdfjs}, mathlive fonts)`);
