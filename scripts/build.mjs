import { copyFile, cp, mkdir } from "node:fs/promises";

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
console.log("Anna UI bundle: release/bundle");
