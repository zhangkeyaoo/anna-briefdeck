import { copyFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const path = name => new URL(name, root);
await cp(path("bundle/"), path("release/bundle/"), { recursive: true });
await mkdir(path("release/bundle/vendor/"), { recursive: true });
await copyFile(
  path("node_modules/pptxgenjs/dist/pptxgen.bundle.js"),
  path("release/bundle/vendor/pptxgen.bundle.js")
);
await copyFile(
  path("node_modules/pptxgenjs/LICENSE"),
  path("release/bundle/vendor/pptxgenjs-license.txt")
);
await copyFile(
  path("node_modules/jszip/dist/jszip.min.js"),
  path("release/bundle/vendor/jszip.min.js")
);
await copyFile(
  path("node_modules/jszip/LICENSE.markdown"),
  path("release/bundle/vendor/jszip-license.txt")
);
const pdfs = name => path(`node_modules/pdfjs-dist/${name}`);
const vendor = name => path(`release/bundle/vendor/${name}`);
for (const [source, target] of [
  ["legacy/build/pdf.min.mjs", "pdf.min.js"],
  ["legacy/build/pdf.worker.min.mjs", "pdf.worker.min.js"],
  ["LICENSE", "pdf-license.txt"],
  ["cmaps/LICENSE", "pdf-cmap-license.txt"],
  ["standard_fonts/LICENSE_FOXIT", "pdf-font-foxit-license.txt"],
  ["standard_fonts/LICENSE_LIBERATION", "pdf-font-liberation-license.txt"]
]) await copyFile(pdfs(source), vendor(target));

async function packPdfAssets(directory, fileExtensions) {
  const files = await readdir(pdfs(directory));
  const pairs = await Promise.all(files.filter(file => fileExtensions.test(file)).map(async file => [
    file, (await readFile(pdfs(`${directory}/${file}`))).toString("base64")
  ]));
  return Object.fromEntries(pairs);
}

const [cMapUrl, standardFontDataUrl] = await Promise.all([
  packPdfAssets("cmaps", /\.bcmap$/),
  packPdfAssets("standard_fonts", /\.(pfb|ttf)$/)
]);
await writeFile(vendor("pdf-text-assets.json"), JSON.stringify({ cMapUrl, standardFontDataUrl }));
console.log("Anna UI bundle: release/bundle");
