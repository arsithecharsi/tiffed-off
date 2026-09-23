// Extracts index.html's <body> content and writes it (with a standalone <head>-style
// preamble for fonts/title) to the scratchpad file the Artifact tool publishes from.
// Not part of the shipped site — a one-off helper for keeping the claude.ai artifact
// in sync with index.html.
import { readFileSync, writeFileSync } from "node:fs";

const src = new URL("../index.html", import.meta.url);
const dest = process.argv[2];
if (!dest) { console.error("usage: node build-artifact.mjs <dest-path>"); process.exit(1); }

const text = readFileSync(src, "utf8");
const m = text.match(/<body>([\s\S]*)<\/body>/);
if (!m) { console.error("no <body> found"); process.exit(1); }

const head =
  "<title>TIFFED OFF!</title>\n" +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Luckiest+Guy&family=Nunito:wght@700;800;900&display=swap">\n' +
  '<link rel="stylesheet" href="css/style.css">\n';

writeFileSync(dest, head + m[1], "utf8");
console.log("written", (head + m[1]).length, "bytes to", dest);
