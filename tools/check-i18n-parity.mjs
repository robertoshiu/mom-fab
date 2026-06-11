// tools/check-i18n-parity.mjs — i18n locale parity checker (E6 / F13).
// Loads both locale JSONs and reports:
//   (a) keys present in one locale but missing in the other   → FAIL (exit 1)
//   (b) keys with an empty / whitespace-only value            → FAIL (exit 1)
//   (c) keys whose en-US and zh-TW values are identical       → WARNING (exit 0)
//       (legit for acronyms like "MES"; flagged so untranslated prose is caught)
// Style matches tools/serve.mjs: plain ESM, no third-party deps. Self-testing:
// the exit code IS the contract (0 = parity clean, 1 = parity broken).
//
// Usage: node tools/check-i18n-parity.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = join(here, '..', 'i18n');
const LOCALES = ['en-US', 'zh-TW'];

async function loadLocale(name) {
  const text = await readFile(join(I18N_DIR, `${name}.json`), 'utf8');
  return JSON.parse(text);
}

function isBlank(value) {
  return typeof value !== 'string' || value.trim() === '';
}

const [en, zh] = await Promise.all(LOCALES.map(loadLocale));

const enKeys = new Set(Object.keys(en));
const zhKeys = new Set(Object.keys(zh));

const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k)).sort();
const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k)).sort();

// empty / whitespace values in either locale.
const emptyEn = [...enKeys].filter((k) => isBlank(en[k])).sort();
const emptyZh = [...zhKeys].filter((k) => isBlank(zh[k])).sort();

// identical values across locales (warning only — legit for acronyms).
const identical = [...enKeys]
  .filter((k) => zhKeys.has(k) && en[k] === zh[k])
  .sort();

let failed = false;

if (missingInZh.length) {
  failed = true;
  console.error(`\n[FAIL] ${missingInZh.length} key(s) in en-US missing from zh-TW:`);
  for (const k of missingInZh) console.error(`  - ${k}`);
}
if (missingInEn.length) {
  failed = true;
  console.error(`\n[FAIL] ${missingInEn.length} key(s) in zh-TW missing from en-US:`);
  for (const k of missingInEn) console.error(`  - ${k}`);
}
if (emptyEn.length) {
  failed = true;
  console.error(`\n[FAIL] ${emptyEn.length} empty/whitespace value(s) in en-US:`);
  for (const k of emptyEn) console.error(`  - ${k}`);
}
if (emptyZh.length) {
  failed = true;
  console.error(`\n[FAIL] ${emptyZh.length} empty/whitespace value(s) in zh-TW:`);
  for (const k of emptyZh) console.error(`  - ${k}`);
}

if (identical.length) {
  console.warn(`\n[WARNING] ${identical.length} key(s) share an identical en/zh value (legit for acronyms):`);
  for (const k of identical) console.warn(`  · ${k} = "${en[k]}"`);
}

const total = Math.max(enKeys.size, zhKeys.size);
if (failed) {
  console.error(`\ni18n parity: FAILED (en-US ${enKeys.size} keys, zh-TW ${zhKeys.size} keys)\n`);
  process.exit(1);
}
console.log(`\ni18n parity: OK — ${total} keys per locale, ${identical.length} identical (warned).\n`);
process.exit(0);
