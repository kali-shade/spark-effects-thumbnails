/**
 * Prepares a static deploy folder for GitHub Pages.
 * Copies effects, dist, examples; adds vendor libs; rewrites paths for repo base URL.
 *
 * Usage: BASE_PATH=/repo-name/ node scripts/prepare-pages-deploy.js
 * Or: node scripts/prepare-pages-deploy.js /repo-name/
 */

import fs from "node:fs";
import path from "node:path";

const DEPLOY_DIR = "deploy";
const BASE_PATH = process.env.PAGES_BASE_PATH || process.argv[2] || "/";

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Ensure base path starts and ends with /
const basePath = BASE_PATH.startsWith("/") ? BASE_PATH : `/${BASE_PATH}`;
const basePathNorm = basePath.endsWith("/") ? basePath : `${basePath}/`;

console.log("Preparing GitHub Pages deploy with base:", basePathNorm);

if (fs.existsSync(DEPLOY_DIR)) {
  fs.rmSync(DEPLOY_DIR, { recursive: true });
}
fs.mkdirSync(DEPLOY_DIR, { recursive: true });

// Copy main folders
copyDirSync("effects", path.join(DEPLOY_DIR, "effects"));
copyDirSync("dist", path.join(DEPLOY_DIR, "dist"));
copyDirSync("examples", path.join(DEPLOY_DIR, "examples"));

// Copy vendor from node_modules
const vendorDest = path.join(DEPLOY_DIR, "examples", "js", "vendor");
fs.mkdirSync(vendorDest, { recursive: true });
copyDirSync("node_modules/three", path.join(vendorDest, "three"));
copyDirSync("node_modules/lil-gui", path.join(vendorDest, "lil-gui"));

// Rewrite get-asset-url.js to use paths relative to base
const getAssetUrlPath = path.join(DEPLOY_DIR, "examples", "js", "get-asset-url.js");
let getAssetUrl = fs.readFileSync(getAssetUrlPath, "utf-8");
getAssetUrl = getAssetUrl
  .replace(/fetch\("\/examples\/assets\.json"\)/, 'fetch("examples/assets.json")')
  .replace(/const assetsDirectory = "\/examples\/assets\/"/, 'const assetsDirectory = "examples/assets/"');
fs.writeFileSync(getAssetUrlPath, getAssetUrl);

// Add base tag and rewrite /examples and /dist in effect HTML/JS
function walkDir(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, fn);
    else fn(full);
  }
}

const effectsDir = path.join(DEPLOY_DIR, "effects");

walkDir(effectsDir, (file) => {
  const ext = path.extname(file);
  const rel = path.relative(effectsDir, file);

  if (ext === ".html") {
    let html = fs.readFileSync(file, "utf-8");
    const depth = rel.split(path.sep).length;
    const prefix = Array.from({ length: depth }, () => "..").join("/") || ".";
    const getAssetUrlRelative = `${prefix}/examples/js/get-asset-url.js`;
    html = html.replace(
      /"\/examples\/js\/get-asset-url\.js"/g,
      `"${getAssetUrlRelative}"`,
    );
    html = html.replace("/examples", "examples").replace("/dist", "dist");
    if (!html.includes("<base")) {
      html = html.replace("<head>", `<head>\n  <base href="${basePathNorm}">`);
    }
    fs.writeFileSync(file, html);
  }

  if (ext === ".js") {
    let js = fs.readFileSync(file, "utf-8");
    if (js.includes("/examples/js/get-asset-url.js")) {
      const depth = rel.split(path.sep).length + 1;
      const prefix = Array.from({ length: depth }, () => "..").join("/") || ".";
      js = js.replace(
        /"\/examples\/js\/get-asset-url\.js"/g,
        `"${prefix}/examples/js/get-asset-url.js"`,
      );
      fs.writeFileSync(file, js);
    }
  }
});

// Root index: redirect to effects/
const rootIndex = path.join(DEPLOY_DIR, "index.html");
fs.writeFileSync(
  rootIndex,
  `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${basePathNorm}effects/">
  <title>Spark Effects</title>
</head>
<body>
  <p>Redirecting to <a href="${basePathNorm}effects/">effects</a>...</p>
</body>
</html>
`,
);

console.log("Deploy folder ready at", DEPLOY_DIR);
