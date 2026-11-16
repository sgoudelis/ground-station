#!/usr/bin/env node
/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

/**
 * i18n audit / worklist / coverage-baseline tooling.
 *
 *   node scripts/i18n.mjs audit                    human readable coverage table
 *   node scripts/i18n.mjs pending <lang>           missing keys + English source text
 *   node scripts/i18n.mjs worklist <lang> <dir>    write translatable JSON skeletons
 *   node scripts/i18n.mjs baseline [--write]       read/write coverage-baseline.json
 *   node scripts/i18n.mjs enrich [--write]         materialize inline defaultValue keys into locales/en
 *   node scripts/i18n.mjs check                    machine-readable violations (used by the unit test)
 *
 * Two kinds of strings exist in this UI:
 *   layer A  keys that live in locales/en/<ns>.json (every locale can translate them)
 *   layer B  keys that only exist as t('key', { defaultValue: 'English' }) in the source
 * `enrich` folds layer B into locales/en so a single file set describes the whole UI, which
 * is what makes the gap measurable at all. `defaultValue` stays in the components as a
 * belt-and-braces fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(FRONTEND, 'src');
const LOCALES = path.join(SRC, 'i18n', 'locales');
const BASELINE = path.join(SRC, 'i18n', 'coverage-baseline.json');
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * Greek orthography, as the language actually works (see TRANSLATION_GUIDE.md, "Greek").
 *
 *   1. a word written entirely in capitals carries no accent marks at all
 *   2. an accent that sits on a capital letter is dropped (Άγνωστο -> Αγνωστο, Ώρα -> Ωρα)
 *   3. everything else keeps its accents
 *
 * Rule 3 is the one this repo used to get wrong: an earlier revision dropped the tonos from every
 * word that merely *started* with a capital, which mangles correct Greek such as Ρυθμίσεις,
 * Διακοπή and Αυτόματη. That reading came from strings that are only uppercased by CSS
 * (`text-transform: uppercase`), which is a rendering artefact and must not decide how a stored
 * string is spelled. Nothing here touches a word that contains a lowercase letter.
 */
const GREEK_UPPER_MAP = { 'Ά': 'Α', 'Έ': 'Ε', 'Ή': 'Η', 'Ί': 'Ι', 'Ό': 'Ο', 'Ύ': 'Υ', 'Ώ': 'Ω', 'Ϊ': 'Ι', 'Ϋ': 'Υ' };
const GREEK_ACCENTED_CAPITAL = /[ΆΈΉΊΌΎΏΪΫ]/;
const GREEK_ACCENTED_CAPITAL_G = /[ΆΈΉΊΌΎΏΪΫ]/g;
// A word of two or more capitals, possibly carrying accented capitals (ΔΕΝ, ΕΠΕΞΕΡΓΑΣΊΑ).
const GREEK_UPPERCASE_WORD = /(?:[Α-Ω]|ΐ|ΰ){2,}(?:[Α-Ω]|ΐ|ΰ)*/g;

/** Return the all-caps + initial-capital form Greek requires, leaving other accents alone. */
function greekCaps(text) {
    if (typeof text !== 'string' || !GREEK_ACCENTED_CAPITAL.test(text)) return text;
    // Rule 1: strip accents anywhere inside a word that is entirely uppercase.
    const allCaps = text.replace(GREEK_UPPERCASE_WORD, (word) =>
        word.replace(GREEK_ACCENTED_CAPITAL_G, (ch) => (ch in GREEK_UPPER_MAP ? GREEK_UPPER_MAP[ch] : ch)));
    // Rule 2: an accent on a capital initial letter is dropped; later accents belong to lowercase
    // letters and are correct, so they stay (Ρυθμίσεις keeps its οξύτονος).
    return allCaps.replace(GREEK_ACCENTED_CAPITAL_G, (ch) => GREEK_UPPER_MAP[ch]);
}

/** Values whose Greek spelling can never be right, with the offending fragment. */
function greekOrthographyIssues(text) {
    if (typeof text !== 'string') return [];
    // An accent that sits on a capital letter (rule 2) - Ά, Έ, Ή, Ί, Ό, Ύ, Ώ, Ϊ, Ϋ.
    const issues = [...text.matchAll(GREEK_ACCENTED_CAPITAL_G)].map((m) => m[0]);
    // Rule 1: a word written entirely in capitals carries no accent marks, so a word that opens
    // with a run of capitals and then trails an accented lowercase vowel is half-uppercased.
    for (const word of text.matchAll(/[Α-Ω]{2,}[α-ω]*[άέήίόύώ][α-ωά-ώ]*/g)) issues.push(word[0]);
    return issues;
}
const PLACEHOLDER = /\{\{\s*([\w.]+)(?:\s*,[^}]*)?\s*\}\}/g;

/**
 * Values that were written in the wrong language. Italian/Dutch are the realistic silent-swap
 * vector: the index-aligned translation payloads carry one column per language, so writing the
 * column order alphabetically (it before nl) instead of [..., nl, it, zh] swaps two whole columns
 * and no coverage number notices, because both cells are "filled".
 * Markers are words that cannot legitimately appear in the target language.
 */
const FOREIGN_WORDS = {
    it: { looks: 'Dutch', words: ['geen', 'niet', 'van', 'uit', 'wordt', 'maar', 'ook', 'voor', 'nog', 'mislukt', 'verwijderen', 'instellingen', 'kanaal', 'grootte', 'acties', 'tijd', 'selectie', 'rusland', 'nuttelading', 'kadering', 'wachten', 'het', 'een', 'satelliet', 'details'] },
    nl: { looks: 'Italian', words: ['nessuno', 'nessuna', 'selezione', 'configurazione', 'carico', 'utile', 'dimensione', 'azioni', 'impossibile', 'attesa', 'rilevamento', 'elimina', 'qualsiasi', 'dello', 'degli', 'questa', 'questo', 'dati', 'giappone', 'analizzatore', 'decodificatore'] },
};
const FOREIGN_PATTERNS = Object.fromEntries(Object.entries(FOREIGN_WORDS).map(([lang, spec]) => [
    lang,
    { looks: spec.looks, patterns: spec.words.map((w) => [w, new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'iu')]) },
]));

/** Foreign-language words inside a value, or [] when the value reads like its own locale. */
function crossLanguageIssues(lang, text) {
    const spec = FOREIGN_PATTERNS[lang];
    if (!spec || typeof text !== 'string') return [];
    return spec.patterns.filter(([, re]) => re.test(text)).map(([word]) => word);
}

/**
 * Keys that stay English on purpose.
 * - squawk code titles/scopes/descriptions are regulator-derived reference prose that is only
 *   published in English, and translating it would invent aviation-safety wording.
 * - bare units and interpolation fragments cannot be translated without breaking formatting.
 */
const ENGLISH_ONLY = [
    /^navigation\.packet_map\.squawk\.codes\.[0-9]{4}\.(title|scope|description)$/,
    /^navigation\.packet_map\.squawk\.(about|close|title|listing|regional_note)$/,
    /^navigation\.packet_map\.squawk\.(unlisted|title)\./,
];

export const isEnglishOnly = (key) => ENGLISH_ONLY.some((re) => re.test(key));

const isSourceFile = (name) =>
    /\.(js|jsx)$/.test(name) && !name.includes('.test.') && !name.endsWith('.config.js');

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'i18n' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (isSourceFile(entry.name)) out.push(full);
    }
    return out;
}

/** Namespaces a source file can resolve keys against (useTranslation / getFixedT / ns option). */
function fileNamespaces(text) {
    const namespaces = [];
    for (const match of text.matchAll(/useTranslation\(\s*(\[[^\]]*\]|['"][^'"]+['"])?\s*\)/g)) {
        const arg = match[1];
        if (!arg) namespaces.push('common');
        else if (arg.trim().startsWith('[')) namespaces.push(...arg.match(/['"]([^'"]+)['"]/g).map((s) => s.slice(1, -1)));
        else namespaces.push(arg.replace(/['"]/g, ''));
    }
    for (const match of text.matchAll(/getFixedT\(\s*(?:null|undefined)\s*,\s*['"]([^'"]+)['"]/g)) {
        namespaces.push(match[1]);
    }
    return [...new Set(namespaces)];
}

/** Slice out a JS argument list, honouring nested calls and string literals. */
function argumentList(text, start) {
    let depth = 1;
    let quote = null;
    let i = start;
    while (i < text.length && depth > 0) {
        const c = text[i];
        if (quote) {
            if (c === '\\') i += 1;
            else if (c === quote) quote = null;
        } else if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '(') depth += 1;
        else if (c === ')') depth -= 1;
        i += 1;
    }
    return text.slice(start, i - 1);
}

/** Split an argument list on top-level commas only. */
function splitArguments(text) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current = '';
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (quote) {
            current += c;
            if (c === '\\') { current += text[i + 1] ?? ''; i += 1; }
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '(' || c === '[' || c === '{') depth += 1;
        else if (c === ')' || c === ']' || c === '}') depth -= 1;
        else if (c === ',' && depth === 0) { parts.push(current); current = ''; continue; }
        current += c;
    }
    parts.push(current);
    return parts;
}

const FIRST_ARG = /^\s*(['"`])([^'"`\n]+)\1\s*(?:,|$)/;
const isQuotedLiteral = (text) => {
    const s = text.trim();
    return s.length >= 2 && ['"', "'", '`'].includes(s[0]) && s.at(-1) === s[0];
};
const stripQuotes = (text) => text.trim().slice(1, -1);

/** Every literal t('key', ...) call in the source, with its namespace candidates and English fallback. */
export function collectCalls() {
    const calls = [];
    for (const file of walk(SRC)) {
        const text = fs.readFileSync(file, 'utf8');
        const relative = path.relative(SRC, file).replaceAll(path.sep, '/');
        const fallbackNamespaces = fileNamespaces(text);
        const re = /(?<![\w$.])((?:i18n|tx|t)\.t|t)\(/g;
        for (const match of text.matchAll(re)) {
            const args = argumentList(text, match.index + match[0].length);
            const first = FIRST_ARG.exec(args);
            if (!first) continue;
            const key = first[2];
            if (!/^[A-Za-z0-9_:.\-]+$/.test(key)) continue;
            const rest = args.slice(first.index + first[0].length);
            const parts = splitArguments(rest);
            // t(key, 'fallback') or t(key, { ... }, 'fallback')
            const fallbackArg = parts.find((p) => isQuotedLiteral(p));
            const objectArg = rest.includes('{') ? rest : '';
            const namedDefault = /defaultValue\s*:/.test(rest)
                ? /defaultValue\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/s.exec(rest)
                : null;
            let fallback = null;
            if (namedDefault) fallback = namedDefault[2];
            else if (fallbackArg) fallback = stripQuotes(fallbackArg);
            // `ns: 'x'` option wins over the file-level namespaces.
            const nsOption = /\bns\s*:\s*(\[[^\]]*\]|['"][^'"]+['"])/.exec(objectArg);
            let namespaces;
            let bare = key;
            if (key.includes(':')) {
                [namespaces, bare] = [key.split(':')[0], key.split(':').slice(1).join(':')];
                namespaces = [namespaces];
            } else {
                namespaces = fallbackNamespaces.length ? fallbackNamespaces : ['common'];
            }
            if (nsOption) {
                namespaces = nsOption[1].trim().startsWith('[')
                    ? nsOption[1].match(/['"]([^'"]+)['"]/g).map((s) => s.slice(1, -1))
                    : [nsOption[1].replace(/['"]/g, '')];
            }
            calls.push({
                key,
                bare,
                namespaces: [...new Set(namespaces)],
                fallback,
                plural: /[,{]\s*count\s*:/.test(rest) || /[,{]count\s*[},]/.test(rest),
                file: relative,
            });
        }
    }
    return calls;
}

export function readLocales() {
    const languages = fs.readdirSync(LOCALES).filter((entry) =>
        fs.statSync(path.join(LOCALES, entry)).isDirectory());
    const namespaces = fs.readdirSync(path.join(LOCALES, 'en')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    const table = {};
    for (const lang of languages) {
        table[lang] = {};
        for (const ns of namespaces) {
            const file = path.join(LOCALES, lang, `${ns}.json`);
            table[lang][ns] = fs.existsSync(file) ? flatten(JSON.parse(fs.readFileSync(file, 'utf8'))) : {};
        }
    }
    return { languages: languages.sort(), namespaces, table };
}

export function flatten(object, prefix = '') {
    const out = {};
    for (const [key, value] of Object.entries(object)) {
        const full = prefix + key;
        if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(out, flatten(value, `${full}.`));
        else out[full] = value;
    }
    return out;
}

const PLURAL_FORMS = ['_zero', '_one', '_two', '_few', '_many', '_other'];

const DYNAMIC_LABEL = /labelKey\s*:\s*['"]([A-Za-z0-9_.:-]+)['"]\s*,\s*defaultLabel\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/g;

/**
 * Keys handed to `t()` indirectly through config entries, e.g.
 * `{ key: 'users', labelKey: 'tabs.users', defaultLabel: 'Users' }` rendered as
 * `t(tab.labelKey, { defaultValue: tab.defaultLabel })`. Literal `t()` scanning cannot see them,
 * so they need their own sweep: without an `en` entry such a key silently shows its English
 * default in every language.
 */
export function collectDynamicLabels() {
    const found = [];
    for (const file of walk(SRC)) {
        const text = fs.readFileSync(file, 'utf8');
        const relative = path.relative(SRC, file).replaceAll(path.sep, '/');
        for (const match of text.matchAll(DYNAMIC_LABEL)) {
            found.push({ key: match[1], fallback: match[3], file: relative });
        }
    }
    return found;
}

/** Does this namespace carry the key, either plain or as a plural set? */
const presentIn = (table, ns, entry) => {
    const sheet = table[ns];
    if (!sheet) return false;
    return entry.key in sheet || PLURAL_FORMS.some((suffix) => `${entry.key}${suffix}` in sheet);
};

const hasKey = (table, namespaces, bare, plural) =>
    namespaces.some((ns) => table[ns] && (bare in table[ns]
        || (plural && ['_one', '_other', '_few', '_many', '_two', '_zero'].some((s) => `${bare}${s}` in table[ns]))));

/** Merge source usage with locale contents; this is the single source of truth for all commands. */
export function analyze() {
    const { languages, namespaces, table } = readLocales();
    const calls = collectCalls();
    // One record per resolved key: a key can be referenced from several files/namespaces.
    const keys = new Map();
    for (const call of calls) {
        for (const ns of call.namespaces) {
            const id = `${ns}:${call.bare}`;
            const existing = keys.get(id);
            if (existing) {
                existing.files.add(call.file);
                if (call.plural) existing.plural = true;
                if (call.fallback !== null && existing.fallback !== call.fallback) existing.conflict = true;
                continue;
            }
            keys.set(id, {
                id,
                namespace: ns,
                key: call.bare,
                fallback: call.fallback,
                conflict: false,
                plural: call.plural,
                files: new Set([call.file]),
            });
        }
    }
    const english = table.en;
    const inEn = (entry) => entry.namespace in english && presentIn(english, entry.namespace, entry);
    // The same key can be referenced from files with different namespaces; a key that resolves in one
    // of them is fine, so "unresolved" always means "nowhere in en/", never "not in this namespace".
    const resolvable = (entry) => namespaces.some((ns) => presentIn(english, ns, entry));
    const usedKeys = [...keys.values()];
    const layerA = usedKeys.filter(inEn);
    const layerB = usedKeys.filter((entry) => !inEn(entry));
    const unresolved = layerB.filter((entry) => !resolvable(entry));
    // en entries nobody references with a literal call: reachable only through dynamic keys.
    const referenced = new Set(usedKeys.flatMap((entry) => [entry.key, `${entry.namespace}.${entry.key}`]));
    const orphans = {};
    for (const ns of namespaces) {
        orphans[ns] = Object.keys(english[ns]).filter((key) =>
            !referenced.has(key) && !referenced.has(`${ns}.${key}`) && !isEnglishOnly(`${ns}.${key}`));
    }
    const missing = {};
    for (const lang of languages) {
        if (lang === 'en') continue;
        missing[lang] = {};
        for (const ns of namespaces) {
            missing[lang][ns] = Object.keys(english[ns])
                .filter((key) => !(key in table[lang][ns]) && !isEnglishOnly(`${ns}.${key}`))
                .sort();
        }
    }
    return { languages, namespaces, table, calls, usedKeys, layerA, layerB, unresolved, orphans, missing };
}

const count = (perNamespace) => Object.values(perNamespace).reduce((sum, list) => sum + list.length, 0);

/* ---------------------------------------------------------------- commands */

function commandAudit() {
    const report = analyze();
    const widths = 12;
    console.log(`namespaces: ${report.namespaces.join(', ')}`);
    console.log(`languages : ${report.languages.join(', ')}`);
    console.log(`en leaf keys: ${report.namespaces.reduce((sum, ns) => sum + Object.keys(report.table.en[ns]).length, 0)}`);
    const uniqueLayerB = new Map(report.layerB.map((entry) => [entry.key, entry])).size;
    console.log(`source keys: ${report.usedKeys.length} namespace-qualified references, ${new Set(report.usedKeys.map((e) => e.key)).size} distinct, ${report.layerA.length} resolve in en/, ${uniqueLayerB} inline-fallback only`);
    const noFallback = new Set(report.unresolved.filter((entry) => entry.fallback === null).map((entry) => entry.key));
    const viaFallback = new Set(report.unresolved.filter((entry) => entry.fallback !== null).map((entry) => entry.key));
    console.log(`keys that render their own key name (no en entry, no fallback): ${noFallback.size}`);
    console.log(`keys rendering English from an inline fallback only (skipped by enrich on purpose): ${viaFallback.size}`);
    console.log('');
    const head = ['lang', ...report.namespaces.map((ns) => ns.slice(0, widths).padStart(widths)), 'TOTAL', 'COVER'].join(' ');
    console.log(head);
    console.log('-'.repeat(head.length));
    for (const lang of report.languages) {
        if (lang === 'en') continue;
        const enTotal = report.namespaces.reduce((sum, ns) => sum + Object.keys(report.table.en[ns]).length, 0);
        const missingTotal = count(report.missing[lang]);
        const cells = report.namespaces.map((ns) => (report.missing[lang][ns].length || '-').toString().padStart(widths));
        console.log([lang, ...cells, String(missingTotal).padStart(6), `${(100 * (1 - missingTotal / enTotal)).toFixed(1)}%`.padStart(6)].join(' '));
    }
    console.log('');
    console.log(`largest single gap groups (${report.languages.includes('de') ? 'de' : report.languages[1]}):`);
    const groups = new Map();
    for (const [ns, list] of Object.entries(report.missing.de || {})) {
        for (const key of list) {
            const parts = key.split('.');
            const group = parts.length > 1 ? `${ns}.${parts.slice(0, Math.min(2, parts.length - 1)).join('.')}` : ns;
            groups.set(group, (groups.get(group) || 0) + 1);
        }
    }
    for (const [group, total] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`  ${String(total).padStart(5)}  ${group}`);
    }
}

function pendingList(report, lang) {
    const rows = [];
    for (const [ns, list] of Object.entries(report.missing[lang])) {
        for (const key of list) {
            rows.push({ namespace: ns, key, english: report.table.en[ns][key], group: key.split('.')[0] });
        }
    }
    // Layer-B keys are already counted above once enriched; add the ones still outside en/ entirely.
    for (const entry of report.unresolved) {
        if (entry.fallback === null) continue;
        const table = report.table[lang][entry.namespace];
        if (table && (entry.key in table)) continue;
        rows.push({ namespace: entry.namespace, key: entry.key, english: entry.fallback, inline: true, group: entry.key.split('.')[0] });
    }
    return rows.sort((a, b) => `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`));
}

function commandPending(lang, args) {
    const report = analyze();
    if (!report.languages.includes(lang)) throw new Error(`unknown language '${lang}' (have ${report.languages.join(', ')})`);
    const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
    const group = args.includes('--group') ? args[args.indexOf('--group') + 1] : null;
    let rows = pendingList(report, lang);
    if (group) rows = rows.filter((row) => `${row.namespace}.${row.key}`.startsWith(group));
    console.error(`# ${lang}: ${rows.length} untranslated strings (${rows.filter((r) => r.inline).length} inline-only)`);
    rows.slice(0, limit).forEach((row) => {
        console.log(`${row.namespace}:${row.key}\t${row.inline ? '[inline-only] ' : ''}${JSON.stringify(row.english)}`);
    });
}

function commandWorklist(lang, outDir) {
    const report = analyze();
    fs.mkdirSync(outDir, { recursive: true });
    const rows = pendingList(report, lang);
    const byNamespace = new Map();
    for (const row of rows) {
        if (!byNamespace.has(row.namespace)) byNamespace.set(row.namespace, {});
        byNamespace.get(row.namespace)[row.key] = row.english;
    }
    for (const [ns, entries] of byNamespace) {
        const target = path.join(outDir, `${lang}--${ns}.json`);
        fs.writeFileSync(target, `${JSON.stringify(nest(entries), null, 4)}\n`);
        console.log(`${target}: ${Object.keys(entries).length} strings`);
    }
}

/** Turn dotted keys back into nested objects so translators see the same shape as the app. */
function nest(entries) {
    const root = {};
    for (const [dotted, value] of Object.entries(entries).sort()) {
        const parts = dotted.split('.');
        let node = root;
        for (const part of parts.slice(0, -1)) node = node[part] ??= {};
        node[parts.at(-1)] = value;
    }
    return root;
}

function commandBaseline(write) {
    const report = analyze();
    const data = {
        _comment: 'Per-language string counts tracked by CI. See src/i18n/__tests__/coverage.test.js: `missing` may only go down, `unknown` (dead locale entries) may only shrink. Update with `npm run i18n:baseline` after translating; never raise `missing` to silence a failure.',
        languages: {},
        rawKeyFallbacks: new Set(report.unresolved.filter((entry) => entry.fallback === null).map((entry) => entry.key)).size,
    };
    for (const lang of Object.keys(report.missing)) {
        const unknown = report.namespaces.reduce((sum, ns) => sum + Object.keys(report.table[lang][ns])
            .filter((key) => !(key in report.table.en[ns]) && !report.usedKeys.some((e) => e.namespace === ns && e.key === key)).length, 0);
        data.languages[lang] = { missing: count(report.missing[lang]), unknown };
    }
    const serialized = `${JSON.stringify(data, null, 2)}\n`;
    if (!write) {
        console.log(serialized);
        return;
    }
    fs.writeFileSync(BASELINE, serialized);
    console.log(`wrote ${BASELINE}`);
}

/**
 * Fold inline `defaultValue` keys into locales/en so every translatable string is visible in one place.
 * Only exact, unambiguous English literals are copied: differing fallbacks for one key are skipped so
 * no string is ever invented here.
 */
function commandEnrich(write) {
    const report = analyze();
    const planned = new Map(); // namespace -> { dotted key: english }
    const skipped = [];
    for (const entry of report.layerB) {
        if (entry.fallback === null) continue;
        // Reachable from another namespace already: copying it here would create a shadow copy.
        if (report.namespaces.some((ns) => presentIn(report.table.en, ns, entry))) continue;
        if (entry.conflict) { skipped.push([entry.id, 'different fallback text at several call sites']); continue; }
        if (/\$\{/.test(entry.fallback)) { skipped.push([entry.id, 'JS template interpolation in fallback', entry.fallback]); continue; }
        if (/\{\{/.test(entry.fallback) && !/\}\}/.test(entry.fallback)) { skipped.push([entry.id, 'truncated interpolation', entry.fallback]); continue; }
        const text = entry.fallback.trim();
        // Pure units ("MHz"), numbers and short all-caps acronyms stay English by project rule; everything
        // else is copied verbatim, so enrich can never invent English text.
        if (!/[A-Za-z]/.test(text) || (/^[A-Z0-9]+$/.test(text) && text.length <= 4)) { skipped.push([entry.id, 'unit or untranslated acronym', entry.fallback]); continue; }
        if (isEnglishOnly(entry.key)) { skipped.push([entry.id, 'English-only reference text']); continue; }
        if (!report.namespaces.includes(entry.namespace)) { skipped.push([entry.id, `unknown namespace`]); continue; }
        if (entry.key in report.table.en[entry.namespace]) continue;
        if (!planned.has(entry.namespace)) planned.set(entry.namespace, {});
        planned.get(entry.namespace)[entry.key] = entry.fallback.replaceAll('\\"', '"').replaceAll("\\'", "'");
    }
    let added = 0;
    for (const [ns, entries] of planned) {
        const file = path.join(LOCALES, 'en', `${ns}.json`);
        const raw = fs.readFileSync(file, 'utf8');
        const data = JSON.parse(raw);
        for (const [dotted, value] of Object.entries(entries)) {
            const parts = dotted.split('.');
            let node = data;
            for (const part of parts.slice(0, -1)) node = node[part] ??= {};
            node[parts.at(-1)] = value;
            added += 1;
        }
        const out = `${JSON.stringify(data, null, 2)}\n`;
        if (write) fs.writeFileSync(file, out);
        console.log(`${write ? 'wrote' : 'would write'} ${file}: +${Object.keys(entries).length} keys`);
    }
    console.log(`\n${write ? 'added' : 'would add'} ${added} en/ keys; skipped ${skipped.length}`);
    for (const [id, why, value] of skipped.slice(0, 25)) console.log(`  skip ${id}: ${why}${value === undefined ? '' : ` -> ${JSON.stringify(value)}`}`);
}

/**
 * Fill gaps from the language's own existing work instead of translating from scratch.
 *
 * A string is often translated in one namespace but requested from another (`map_settings.apply`
 * lives in `common` but `earthview` asks for it), so the gap is bookkeeping, not missing work.
 * Two matches are accepted, both requiring the English text to be identical:
 *   1. same dotted key path in another namespace,
 *   2. any key in any namespace whose English text is identical.
 * That keeps the project's own approved wording and never invents a translation.
 */
function commandReuse(write) {
    const report = analyze();
    const pluralFormsOf = (table, stem) => Object.keys(table)
        .filter((key) => {
            const match = PLURAL_SUFFIX.exec(key);
            return match && key.slice(0, match.index) === stem;
        });
    const stats = {};
    const planned = new Map();
    for (const lang of report.languages) {
        if (lang === 'en') continue;
        // English text -> a translation this language already ships for exactly that text.
        const byEnglish = new Map();
        for (const ns of report.namespaces) {
            for (const [key, value] of Object.entries(report.table[lang][ns])) {
                const english = report.table.en[ns]?.[key];
                if (english === undefined || typeof value !== 'string' || !value.trim()) continue;
                if (String(english) === String(value) || !/\p{L}/u.test(String(value))) continue;
                if (!byEnglish.has(String(english))) byEnglish.set(String(english), { value, from: `${ns}:${key}` });
            }
        }
        const resolve = (ns, key) => {
            const english = String(report.table.en[ns][key]);
            if (typeof english !== 'string' || !english) return null;
            for (const other of report.namespaces) {
                if (other === ns) continue;
                const value = report.table[lang][other][key];
                if (typeof value !== 'string' || !value.trim() || value === english || !/\p{L}/u.test(value)) continue;
                if (report.table.en[other]?.[key] === undefined || String(report.table.en[other][key]) !== english) continue;
                return { value, from: `${other}:${key}` };
            }
            const twin = byEnglish.get(english);
            return twin ? { value: twin.value, from: `${twin.from} (same text)` } : null;
        };
        const target = {};
        for (const ns of report.namespaces) {
            for (const key of report.missing[lang][ns]) {
                const found = resolve(ns, key);
                if (found) target[`${ns}:${key}`] = found;
            }
        }
        // Plural families are atomic: a lone `_other` is a hard failure, so a family is only filled
        // when every form it still needs can be resolved.
        const seen = new Set();
        for (const id of Object.keys(target)) {
            const [ns, key] = id.split(':');
            const suffix = PLURAL_SUFFIX.exec(key);
            if (!suffix) continue;
            const stem = key.slice(0, suffix.index);
            const familyId = `${ns}\u0000${stem}`;
            if (seen.has(familyId)) continue;
            seen.add(familyId);
            const forms = pluralFormsOf(report.table.en[ns], stem);
            const block = [];
            for (const form of forms) {
                if (form in report.table[lang][ns] || `${ns}:${form}` in target) continue;
                const extra = resolve(ns, form);
                if (extra) target[`${ns}:${form}`] = extra;
                else block.push(form);
            }
            if (block.length) {
                for (const form of forms) delete target[`${ns}:${form}`];
            }
        }
        planned.set(lang, target);
        stats[lang] = Object.keys(target).length;
    }
    let written = 0;
    for (const [lang, entries] of planned) {
        const byNamespace = new Map();
        for (const [id, found] of Object.entries(entries)) {
            const [ns, key] = id.split(':');
            if (!byNamespace.has(ns)) byNamespace.set(ns, {});
            byNamespace.get(ns)[key] = found.value;
        }
        for (const [ns, sheet] of byNamespace) {
            const file = path.join(LOCALES, lang, `${ns}.json`);
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            for (const [dotted, value] of Object.entries(sheet)) {
                const parts = dotted.split('.');
                let node = data;
                for (const part of parts.slice(0, -1)) node = node[part] ??= {};
                node[parts.at(-1)] = lang === 'el' ? greekCaps(value) : value;
                written += 1;
            }
            if (write) fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
            console.log(`${write ? 'wrote' : 'would write'} ${file}: +${Object.keys(sheet).length} keys`);
        }
        console.log(`${lang}: ${stats[lang]} gaps closable from its own existing translations`);
    }
    console.log(`\ntotal ${write ? 'filled' : 'fillable'}: ${written}`);
    if (write) console.log('\nrun `npm run i18n:baseline` to bank the improvement');
}

function commandCheck() {
    const report = analyze();
    const violations = [];
    const warnings = [];
    const unknownTotals = {};
    const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;

    // 1. keys the user would see verbatim: no locale entry anywhere and no inline fallback.
    const rawKey = report.unresolved.filter((entry) => entry.fallback === null && !isEnglishOnly(entry.key));
    for (const entry of rawKey) {
        // A key resolved through a passed-in translator can live in a namespace this file never names.
        const reachable = report.namespaces.some((ns) => presentIn(report.table.en, ns, entry));
        if (!reachable) violations.push(`raw-key: ${entry.id} used in ${[...entry.files].join(', ')} with no en entry and no fallback`);
    }

    // 1b. labels wired through { labelKey, defaultLabel } arrays: only an entry in en/ makes them
    // translatable, otherwise the English default is what every language renders.
    for (const label of collectDynamicLabels()) {
        const reachable = report.namespaces.some((ns) => presentIn(report.table.en, ns, { key: label.key }));
        if (!reachable) {
            violations.push(`dynamic-label-missing: ${label.file} labelKey '${label.key}' (default '${label.fallback}') has no en/ entry, so it renders English in every language`);
        }
    }

    // 1c. keys whose reference cannot reach them: the key lives in a different namespace than the one the
    // calling code binds, so `t()` falls through to its inline English default in *every* language. The
    // coverage ratchet cannot see this (the key is fully translated in its own namespace) and English
    // users notice nothing, so it surfaces here as a warning.
    // Reported only when every reference to the key binds a single namespace: multi-namespace files are
    // ambiguous for a static scan because `t` can be passed down from a component bound elsewhere.
    for (const entry of report.layerB) {
        if (entry.fallback === null || entry.plural) continue;
        if (!report.namespaces.some((ns) => presentIn(report.table.en, ns, entry))) continue;
        const bound = new Set(report.usedKeys
            .filter((other) => other.key === entry.key && [...other.files].some((f) => entry.files.has(f)))
            .map((other) => other.namespace));
        if (bound.size !== 1) continue;
        const home = report.namespaces.filter((ns) => presentIn(report.table.en, ns, entry));
        warnings.push(`wrong-namespace: ${entry.id} (default '${String(entry.fallback).slice(0, 40)}') is translated in ${home.join(', ')} but referenced from ${[...entry.files].join(', ')} bound to ${[...bound].join(', ')} -> renders English; use t('${home[0]}:${entry.key}')`);
    }

    for (const lang of report.languages) {
        if (lang === 'en') continue;
        for (const ns of report.namespaces) {
            // 2. values that lost or invented an interpolation variable
            for (const [key, value] of Object.entries(report.table[lang][ns])) {
                if (!(key in report.table.en[ns])) continue;
                const vars = (text) => JSON.stringify([...String(text).matchAll(PLACEHOLDER)].map((m) => m[1]).sort());
                if (vars(report.table.en[ns][key]) !== vars(value)) {
                    violations.push(`placeholder-drift: ${lang}/${ns}.${key}`);
                }
                if (typeof value === 'string' && !value.trim()) violations.push(`empty-value: ${lang}/${ns}.${key}`);
            }
            // 2b. Greek orthography: an accent on a capital letter, or a tonos inside a word written
            //     entirely in capitals, is never valid Greek. Accents that sit on the lowercase part
            //     of a capitalized word are correct, so this does NOT flag Ρυθμίσεις/Διακοπή.
            if (lang === 'el') {
                for (const [key, value] of Object.entries(report.table[lang][ns])) {
                    const issues = greekOrthographyIssues(value);
                    if (issues.length) {
                        violations.push(`greek-orthography: el/${ns}.${key} (${[...new Set(issues)].join(', ')})`);
                    }
                }
            }
            // 2c. a value written in a sibling language (see FOREIGN_WORDS) is fully "translated" as
            //     far as coverage counts go, so this is the only thing that surfaces a swapped fill.
            if (FOREIGN_PATTERNS[lang]) {
                for (const [key, value] of Object.entries(report.table[lang][ns])) {
                    const foreign = crossLanguageIssues(lang, value);
                    if (foreign.length) {
                        warnings.push(`lang-mismatch: ${lang}/${ns}.${key} reads as ${FOREIGN_PATTERNS[lang].looks} (${foreign.slice(0, 3).join(', ')}) -> '${String(value).slice(0, 60)}'`);
                    }
                }
            }
            // 3. half a plural pair (only real plural categories count, so `group_other` is not a form)
            for (const key of Object.keys(report.table[lang][ns])) {
                const match = PLURAL_SUFFIX.exec(key);
                if (!match) continue;
                const stem = key.slice(0, match.index);
                const isPluralForm = (k) => {
                    const suffix = PLURAL_SUFFIX.exec(k);
                    return suffix && k.slice(0, suffix.index) === stem;
                };
                const inEn = Object.keys(report.table.en[ns]).filter(isPluralForm);
                if (inEn.length < 2 || !inEn.some((k) => PLURAL_SUFFIX.test(k))) continue;
                const siblings = inEn.filter((k) => k in report.table[lang][ns]);
                if (siblings.length && siblings.length < inEn.length) {
                    violations.push(`partial-plurals: ${lang}/${ns}.${stem} has ${siblings.length}/${inEn.length} forms`);
                }
            }
            // 4. keys a locale carries that nothing references: dead weight, renamed keys, or keys the
            //    component asks for under a different namespace. Warning only - dynamic keys land here too.
            const unknown = Object.keys(report.table[lang][ns])
                .filter((key) => !(key in report.table.en[ns]) && !report.usedKeys.some((e) => e.namespace === ns && e.key === key));
            if (unknown.length) warnings.push(`unknown-keys: ${lang}/${ns}.json holds ${unknown.length} key(s) absent from en/ and unreferenced (e.g. ${unknown[0]})`);
            unknownTotals[lang] = (unknownTotals[lang] || 0) + unknown.length;
        }
    }

    // 5. coverage may only improve
    if (baseline) {
        for (const [lang, info] of Object.entries(report.missing)) {
            const allowed = baseline.languages[lang]?.missing;
            const now = count(info);
            if (typeof allowed === 'number' && now > allowed) {
                violations.push(`coverage-regression: ${lang} untranslated grew from ${allowed} to ${now}`);
            }
        }
        if (typeof baseline.rawKeyFallbacks === 'number') {
            const now = new Set(rawKey.map((entry) => entry.key)).size;
            if (now > baseline.rawKeyFallbacks) {
                violations.push(`raw-key-regression: ${baseline.rawKeyFallbacks} -> ${now} keys render their own key name`);
            }
        }
        for (const [lang, total] of Object.entries(unknownTotals)) {
            const allowed = baseline.languages[lang]?.unknown;
            if (typeof allowed === 'number' && total > allowed) {
                warnings.push(`unknown-key-growth: ${lang} dead locale entries grew from ${allowed} to ${total}`);
            }
        }
    }
    return { violations, warnings, unknownTotals, report };
}

// Only run the CLI when this file is executed directly, so the unit test can import it.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
    const [, , cmd = 'audit', ...rest] = process.argv;
    if (cmd === 'audit') commandAudit();
    else if (cmd === 'pending') commandPending(rest[0], rest.slice(1));
    else if (cmd === 'worklist') commandWorklist(rest[0], path.resolve(rest[1] || 'i18n-worklist'));
    else if (cmd === 'baseline') commandBaseline(rest.includes('--write'));
    else if (cmd === 'enrich') commandEnrich(rest.includes('--write'));
    else if (cmd === 'reuse') commandReuse(rest.includes('--write'));
    else if (cmd === 'check') {
        const { violations, warnings } = commandCheck();
        warnings.forEach((w) => console.warn(`  ~ ${w}`));
        if (!violations.length) console.log(`i18n check: no violations (${warnings.length} warning(s))`);
        else { console.error(`i18n check: ${violations.length} violation(s)`); violations.forEach((v) => console.error(`  - ${v}`)); process.exitCode = 1; }
    } else {
        console.error('usage: node scripts/i18n.mjs <audit|pending|worklist|reuse|baseline|enrich|check> [...]');
        process.exitCode = 2;
    }
}

export { commandCheck as check, greekCaps, greekOrthographyIssues, crossLanguageIssues };
