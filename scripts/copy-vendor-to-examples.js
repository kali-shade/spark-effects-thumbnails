/**
 * Copies three and lil-gui from node_modules to examples/js/vendor.
 * Run after npm install so that hosting the repo root serves /examples/js/vendor/ (for /effects/).
 */

import fs from "node:fs";
import path from "node:path";

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

const vendorDest = "examples/js/vendor";
fs.mkdirSync(vendorDest, { recursive: true });

if (!fs.existsSync("node_modules/three")) {
  console.error("Run npm install first.");
  process.exit(1);
}

copyDirSync("node_modules/three", path.join(vendorDest, "three"));
copyDirSync("node_modules/lil-gui", path.join(vendorDest, "lil-gui"));
console.log("Copied three and lil-gui to", vendorDest);
