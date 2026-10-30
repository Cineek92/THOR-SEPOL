#!/usr/bin/env node
/**
 * Przygotowuje katalog www/ dla Capacitora:
 *  1. Kopiuje "THOR (Web).html" (z katalogu głównego repo) do www/index.html
 *     — albo używa istniejącego www/index.html, jeśli pliku w katalogu głównym brak.
 *  2. Wstrzykuje native/thor-native-patch.js przed </body>, jeśli w HTML
 *     nie ma jeszcze znacznika THOR_NATIVE_PATCH.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const WWW = join(ROOT, "www");
const TARGET = join(WWW, "index.html");
const PATCH = join(ROOT, "native", "thor-native-patch.js");
const MARKER = "THOR_NATIVE_PATCH";

function fail(msg) {
  console.error("::error::" + msg);
  process.exit(1);
}

function findSource() {
  const preferred = join(ROOT, "THOR (Web).html");
  if (existsSync(preferred)) return preferred;
  /* tolerancja nazw po uploadzie przez przeglądarkę, np. "THOR_(Web).html" */
  const alt = readdirSync(ROOT).find((f) => /^THOR.*\.html?$/i.test(f));
  if (alt) return join(ROOT, alt);
  if (existsSync(TARGET)) return TARGET;
  return null;
}

const src = findSource();
if (!src) fail('Nie znaleziono "THOR (Web).html" w katalogu głównym ani www/index.html.');

let html = readFileSync(src, "utf8");
if (!/<\/body>/i.test(html)) fail("Plik HTML nie zawiera znacznika </body>.");
if (!/function\s+download\s*\(/.test(html)) console.warn("::warning::Nie znaleziono function download(...) w HTML.");
if (!/function\s+shareBlob\s*\(/.test(html)) console.warn("::warning::Nie znaleziono function shareBlob(...) w HTML.");

if (html.includes(MARKER)) {
  console.log("Patch natywny już jest w HTML — pomijam wstrzykiwanie.");
} else {
  if (!existsSync(PATCH)) fail("Brak pliku native/thor-native-patch.js.");
  const patch = readFileSync(PATCH, "utf8");
  if (/<\/script/i.test(patch)) fail("Patch nie może zawierać sekwencji </script.");
  const block = '<script id="thor-native-patch">\n' + patch + "\n</script>\n";
  const idx = html.toLowerCase().lastIndexOf("</body>");
  html = html.slice(0, idx) + block + html.slice(idx);
  console.log("Wstrzyknięto patch natywny przed </body>.");
}

mkdirSync(WWW, { recursive: true });
writeFileSync(TARGET, html, "utf8");
console.log(`Źródło: ${src}\nZapisano: ${TARGET} (${Buffer.byteLength(html)} B)`);
