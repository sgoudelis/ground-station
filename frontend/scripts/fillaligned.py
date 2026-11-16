#!/usr/bin/env python3
"""Index-aligned locale filler.

usage: echo '<json array of values>' | python3 fillaligned.py <lang> <ns> <keyfile>
Values must line up with the (sorted) dotted keys in <keyfile>. A wrong-length
array aborts; any value whose {{placeholders}} differ from the English source is
refused, which catches off-by-one alignment errors.
"""
import json, sys, re, unicodedata

lang, ns, keyfile = sys.argv[1], sys.argv[2], sys.argv[3]
base = "src/i18n/locales"
keys = [l.strip() for l in open(keyfile) if l.strip()]
values = json.load(sys.stdin)
if len(values) != len(keys):
    sys.exit(f"ABORT length mismatch: {len(values)} values vs {len(keys)} keys")
en = json.load(open(f"{base}/en/{ns}.json", encoding="utf-8"))


def leaf(node, path):
    cur = node
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur if not isinstance(cur, dict) else None


ph = lambda t: sorted(re.findall(r"\{\{\s*([\w.]+)", str(t)))
data = json.load(open(f"{base}/{lang}/{ns}.json", encoding="utf-8"))
added = skipped = mismatch = 0
for i, (key, value) in enumerate(zip(keys, values)):
    source = leaf(en, key)
    if source is None:
        skipped += 1
        continue
    if value is None:
        skipped += 1
        continue
    # No orthographic transform here: correct Greek keeps its tonos in capitalised
    # words. All-caps / accented-capital handling lives in scripts/i18n.mjs (greekCaps)
    # and scripts/repairgreek.py.
    if ph(source) != ph(value):
        print(f"  !! index {i} {key}: placeholder mismatch (en={source!r}, got={value!r})")
        mismatch += 1
        continue
    parts = key.split(".")
    node = data
    for part in parts[:-1]:
        nxt = node.get(part)
        if nxt is None:
            nxt = node[part] = {}
        node = nxt
    if isinstance(node, dict) and parts[-1] in node:
        skipped += 1
        continue
    node[parts[-1]] = value
    added += 1
if mismatch:
    sys.exit(f"ABORT {mismatch} placeholder mismatches - array is mis-aligned")
open(f"{base}/{lang}/{ns}.json", "w", encoding="utf-8").write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
print(f"{lang}/{ns}: +{added} added, {skipped} skipped (already present or not in en)")
