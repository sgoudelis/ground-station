#!/usr/bin/env python3
"""Translate-by-English-text filler for the non-English locales.
Reads a JSON array of [en, de, el, es, fr, nl, it, zh] on stdin (null = skip that lang),
maps English text -> translations in a persistent map, then for every missing
(lang,ns,key) row whose text is known, shells out to fillaligned.py per lang/ns.

!! COLUMN ORDER IS [en, de, el, es, fr, nl, it, zh] - NOT alphabetical. `nl` comes BEFORE `it`,
so writing the payload in dictionary order silently swaps every Italian and Dutch value. Both
cells still count as translated, so coverage stays green; `i18n check` reports the damage as
`lang-mismatch:` and coverage.test.js fails on it. Verified before banking a batch:
  node scripts/i18n.mjs check | grep lang-mismatch

Run from `frontend/`. Needs /tmp/i18n-rows.json: a JSON array of
{"ns":..., "k":<dotted key>, "en":<english text>, "miss":[langs]}. Build it with:
  node -e "import('$PWD/scripts/i18n.mjs').then(({analyze})=>{const r=analyze(),fs=require('fs'),
  langs=['de','el','es','fr','nl'],rows=[];for(const ns of ['common','filebrowser']){const en=r.table.en[ns];
  for(const k of Object.keys(en)){if(typeof en[k]!=='string')continue;
  const miss=langs.filter(l=>!(k in r.table[l][ns]));if(miss.length)rows.push({ns,k,en:en[k],miss});}}
  fs.writeFileSync('/tmp/i18n-rows.json',JSON.stringify(rows));console.log(rows.length);});"
Then: python3 scripts/fillbytext.py < chunk.json   (chunk = [[en,de,el,es,fr,nl], ...])
"""
import json, subprocess, collections, sys, os

LANGS = ['de', 'el', 'es', 'fr', 'nl', 'it', 'zh']  # payload columns after the English text
rows = json.load(open('/tmp/i18n-rows.json'))
mpath = '/tmp/i18n-map.json'
m = json.load(open(mpath)) if os.path.exists(mpath) else {}
for item in json.load(sys.stdin):
    en = item[0]
    m[en] = dict(zip(LANGS, item[1:]))
json.dump(m, open(mpath, 'w'), ensure_ascii=False)
groups = collections.defaultdict(lambda: ([], []))
for row in rows:
    t = m.get(row['en'])
    if not t:
        continue
    for lang in row['miss']:
        v = t.get(lang)
        if v is not None:
            groups[(lang, row['ns'])][0].append(row['k'])
            groups[(lang, row['ns'])][1].append(v)
for (lang, ns), (keys, vals) in sorted(groups.items()):
    kf = '/tmp/i18n-keys.txt'
    open(kf, 'w').write('\n'.join(keys) + '\n')
    p = subprocess.run(['python3', 'scripts/fillaligned.py', lang, ns, kf],
                       input=json.dumps(vals, ensure_ascii=False), capture_output=True, text=True)
    print(p.stdout.strip() or p.stderr.strip())
print('texts mapped total:', len(m))
