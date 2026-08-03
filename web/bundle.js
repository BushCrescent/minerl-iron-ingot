/* Bundle the site into one self-contained HTML file.
 *
 *   node web/bundle.js            -> dist/index.html    (standalone page)
 *   node web/bundle.js --artifact -> dist/artifact.html (content only, for
 *                                     hosts that supply their own skeleton)
 *
 * No dependencies. Inlines styles.css and concatenates the ES modules in
 * dependency order, stripping the import/export syntax that only makes sense
 * across separate files.
 *
 * Note: this cannot inline web/assets/ — the bundled page still fetches
 * screenshots and video relative to itself, and shows placeholders without them.
 */

const fs = require("fs");
const path = require("path");

const WEB = __dirname;
const DIST = path.join(WEB, "..", "dist");
const artifactMode = process.argv.includes("--artifact");
const read = (f) => fs.readFileSync(path.join(WEB, f), "utf8");

/* data -> charts -> demo -> app. Any other order breaks the references. */
const MODULES = ["data.js", "charts.js", "demo.js", "app.js"];

function flatten(src) {
  return src
    .replace(/^\s*import\s+[^;]*?from\s*["'][^"']+["']\s*;?\s*$/gm, "")  // import { a } from "./x.js"
    .replace(/^\s*import\s+["'][^"']+["']\s*;?\s*$/gm, "")               // import "./x.js"
    // export const X -> const X; also handles `export async function`
    .replace(/^\s*export\s+(?=(async\s+)?(const|let|var|function|class)\b)/gm, "");
}

const html = read("index.html");
const pick = (re, fallback = "") => (html.match(re) || [, fallback])[1];

const title = pick(/<title>([\s\S]*?)<\/title>/i, "Project");
const desc = pick(/<meta\s+name="description"\s+content="([^"]*)"/i);
const body = pick(/<body>([\s\S]*)<\/body>/i)
  .replace(/\s*<script src="config\.js"><\/script>/, "")
  .replace(/\s*<script type="module" src="app\.js"><\/script>/, "")
  .trim();

const css = read("styles.css");
const config = read("config.js");
const script = MODULES.map((m) => `/* ===== ${m} ===== */\n${flatten(read(m))}`).join("\n");

const FAVICON =
  'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22>' +
  '<text y=%22.9em%22 font-size=%2290%22>⛏️</text></svg>';

const content = `<title>${title}</title>
<style>
${css}
</style>

${body}

<script>
${config}
</script>
<script type="module">
${script}
</script>`;

const page = artifactMode
  ? content
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${desc}">
<link rel="icon" href="${FAVICON}">
</head>
<body>
${content}
</body>
</html>`;

fs.mkdirSync(DIST, { recursive: true });
const file = path.join(DIST, artifactMode ? "artifact.html" : "index.html");
fs.writeFileSync(file, page);
console.log(`wrote ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
