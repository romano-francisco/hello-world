#!/usr/bin/env node
/**
 * sync-tokens.js
 * Reads color variables from EMDS 2026 (Figma) and updates css/tokens.css.
 *
 * Usage:
 *   FIGMA_TOKEN=xxx npm run sync-tokens
 *   FIGMA_TOKEN=xxx npm run sync-tokens -- --dry-run   (preview only)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const TOKENS_CSS = join(ROOT, 'css', 'tokens.css');
const FILE_KEY  = 'MpOu6WVIFMtSDEzsMQGZFX'; // EMDS 2026

const TOKEN    = process.env.FIGMA_TOKEN;
const DRY_RUN  = process.argv.includes('--dry-run');

if (!TOKEN) {
  console.error('❌  FIGMA_TOKEN env variable is required.');
  console.error('    Generate one at: https://www.figma.com/settings → Personal access tokens');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Figma RGB (0-1) → HSL (degrees, %, %) */
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case g: h = (b - r) / d + 2; break;
    default: h = (r - g) / d + 4;
  }
  return [Math.round(h / 6 * 360), Math.round(s * 100), Math.round(l * 100)];
}

/** RGBA object → hsla() CSS string */
function toHsla({ r, g, b, a = 1 }) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

/** Strip var() wrapper from code syntax: "var(--bg)" → "--bg" */
function cssVarName(codeSyntax) {
  const m = (codeSyntax || '').match(/var\((.+?)\)/);
  return m ? m[1] : null;
}

/** Derive CSS variable name from Figma variable name (no code syntax).
 *  "lm-blue-neutral/strongest"  → "--lm-blue-neutral-strongest"
 *  "dm-emerald-accent/regular"  → "--dm-emerald-accent-regular"
 */
function deriveCssName(name) {
  return '--' + name.replace(/\//g, '-').replace(/\s+/g, '-').toLowerCase();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔍  Fetching EMDS variables from Figma…`);

  const res = await fetch(
    `https://api.figma.com/v1/files/${FILE_KEY}/variables/local`,
    { headers: { 'X-Figma-Token': TOKEN } }
  );

  if (!res.ok) {
    const txt = await res.text();
    console.error(`❌  Figma API error ${res.status}: ${txt}`);
    process.exit(1);
  }

  const { meta } = await res.json();
  const { variables, variableCollections } = meta;

  // ── Find the Foundations collection ────────────────────────────────────────
  const coll = Object.values(variableCollections)
    .find(c => c.name.toLowerCase().includes('foundations'));

  if (!coll) {
    console.error('❌  Could not find Foundations collection in EMDS.');
    process.exit(1);
  }

  console.log(`✓   Found collection: "${coll.name}"`);
  console.log(`    Modes: ${coll.modes.map(m => m.name).join(', ')}`);

  // ── Build variable map: id → { name, cssName, valuesByMode } ──────────────
  const varById = {};
  for (const v of Object.values(variables)) {
    if (v.variableCollectionId !== coll.id) continue;
    if (v.resolvedType !== 'COLOR') continue;

    const cssName = v.codeSyntax?.WEB
      ? cssVarName(v.codeSyntax.WEB)
      : deriveCssName(v.name);

    varById[v.id] = { ...v, cssName };
  }

  console.log(`    Variables found: ${Object.keys(varById).length} color variables`);

  // ── Resolve all variables to final HSL values per mode ────────────────────
  // Primitives have raw RGBA values; semantics have VARIABLE_ALIAS references.
  // We resolve aliases recursively (max depth 5) to get the raw RGBA.
  function resolveValue(varId, modeId, depth = 0) {
    if (depth > 5) return null;
    const v = varById[varId];
    if (!v) return null;
    const val = v.valuesByMode[modeId] ?? v.valuesByMode[coll.defaultModeId];
    if (!val) return null;
    if (val.type === 'VARIABLE_ALIAS') return resolveValue(val.id, modeId, depth + 1);
    return val; // { r, g, b, a }
  }

  // ── Read current tokens.css ────────────────────────────────────────────────
  let css = readFileSync(TOKENS_CSS, 'utf8');
  let updatedCount = 0;

  // For each variable, find its CSS declaration and replace the value.
  // Pattern:  --css-var-name: hsla(...)  or  --css-var-name: var(...)
  // We use the default mode (first mode = Dark) to get the base primitive values.
  const defaultModeId = coll.defaultModeId;

  for (const v of Object.values(varById)) {
    if (!v.cssName) continue;

    // Only update primitive variables (scopes = [] means hidden / primitive).
    // Semantic variables reference primitives via var() in CSS — no change needed
    // there unless the alias target itself changed, which the primitive sync covers.
    const isPrimitive = !v.codeSyntax?.WEB;
    if (!isPrimitive) continue;

    const raw = resolveValue(v.id, defaultModeId);
    if (!raw) continue;

    const newValue = toHsla(raw);
    const pattern = new RegExp(
      `(${v.cssName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}:\\s*)hsla\\([^)]+\\)`,
      'g'
    );

    const before = css;
    css = css.replace(pattern, `$1${newValue}`);
    if (css !== before) updatedCount++;
  }

  // ── Update timestamp comment ───────────────────────────────────────────────
  const stamp = `Last synced: ${new Date().toISOString()}`;
  css = css.replace(/Last synced: .+/, stamp);
  if (!css.includes('Last synced:')) {
    // Insert after the first comment block
    css = css.replace(
      /(\/\* =+\n[\s\S]*?\n\s*=+ \*\/\n)/,
      `$1/* ${stamp} */\n`
    );
  }

  // ── Write or preview ───────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log(`\n🔎  Dry run — ${updatedCount} values would be updated.`);
    console.log('    Run without --dry-run to apply changes.');
  } else {
    writeFileSync(TOKENS_CSS, css, 'utf8');
    console.log(`\n✅  tokens.css updated — ${updatedCount} color values synced from EMDS.`);
    console.log('    Next: git add css/tokens.css && git commit -m "chore: sync tokens from EMDS"');
  }
}

main().catch(err => { console.error('❌ ', err.message); process.exit(1); });
