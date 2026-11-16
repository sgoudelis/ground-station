#!/usr/bin/env python3
"""Repair Greek orthography in the el locale (see frontend/src/i18n/TRANSLATION_GUIDE.md).

Real rules:
  A. an accent on a capital letter is dropped (Άγνωστο -> Αγνωστο); a word written entirely in
     capitals carries no accent at all.
  B. an accent that belongs to a lowercase letter stays, even when the word starts with a capital
     (Ρυθμίσεις, Διακοπή, Κοντά are correct) - so a capital-initial word that lost such a tonos is
     a bug and gets it restored.

Rule A is mechanical and applies everywhere. Rule B only touches values this session added or
changed (current value differs from HEAD), and only where one accent pattern is attested for the
word - either in the corpus itself or in the curated map at --map.
"""
import json, re, glob, subprocess, sys, collections, argparse

ACCS = 'άέήίόύώ'
DEACC = str.maketrans('άέήίόύώ', 'αεηιουω')
CAPS_TO_PLAIN = str.maketrans('ΆΈΉΊΌΎΏΪΫ', 'ΑΕΗΙΟΥΩΙΥ')
ALLCAPS = re.compile(r'(?:[Α-Ω]|ΐ|ΰ){2,}')
import os
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FILES = sorted(glob.glob(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                       'src', 'i18n', 'locales', 'el', '*.json')))
WORD = re.compile(r'\w+')


def walk(o, pre=''):
    for k, v in o.items():
        if isinstance(v, dict):
            yield from walk(v, pre + k + '.')
        elif isinstance(v, str):
            yield pre + k, v


def set_by_path(obj, dotted, value):
    parts = dotted.split('.')
    cur = obj
    for p in parts[:-1]:
        cur = cur[p]
    cur[parts[-1]] = value


def key_of(word):
    return word.lower().translate(DEACC)


def base_accents(word):
    """Accent positions, ignoring the extra tonos an enclitic adds to the last letter."""
    accs = [(i, c) for i, c in enumerate(word) if c in ACCS]
    if len(accs) > 1 and accs[-1][0] == len(word) - 1:
        accs = accs[:-1]
    return tuple(accs)


def rule_a(text):
    """Correct the two forms that are unconditionally wrong (mechanical, no dictionary needed)."""
    stripped = ALLCAPS.sub(lambda m: m.group(0).translate(
        str.maketrans('ΆΈΉΊΌΎΏΪΫάέήίόύώ', 'ΑΕΗΙΟΥΩΙΥαεηιουω')), text)
    return stripped.translate(CAPS_TO_PLAIN)


def harvest():
    """Every accented word form in HEAD (weight 3, native-approved) and in the working tree (1)."""
    forms = collections.defaultdict(collections.Counter)
    for path in FILES:
        fname = path.split('/')[-1]
        head = subprocess.run(['git', 'show', f'HEAD:frontend/src/i18n/locales/el/{fname}'],
                              capture_output=True, text=True, cwd=REPO)
        for obj, weight in ((json.loads(head.stdout or '{}'), 3), (json.load(open(path)), 1)):
            for _, v in walk(obj):
                for w in WORD.findall(v):
                    if any(c in ACCS for c in w):
                        forms[key_of(w)][(w, base_accents(w))] += weight
    return forms


def canon_from(forms, manual):
    """One canonical word per de-accented key: 'restore' (has a lowercase-letter tonos),
    'correct' (accentless word, or its only tonos sits on the capital = rule A output) or None."""
    canon = {}
    for k, variants in forms.items():
        pats = {p for (_, p) in variants}
        if len(pats) != 1:
            canon[k] = ('ambiguous', None)
            continue
        plain = [wp for wp in variants if wp[0][-1] not in ACCS] or list(variants)
        word = max(plain, key=lambda wp: variants[wp])[0]
        # kind is decided per occurrence later: a capital-initial word only takes a tonos that sits
        # on one of its lowercase letters, a lowercase word takes any tonos at all.
        canon[k] = ('form', word)
    for k, word in manual.items():
        # a curated entry only ever restores a tonos that sits on a lowercase letter; an accent on
        # the capital is dropped by rule A, so such an entry would fight that rule and is dropped
        if [i for i, _ in base_accents(word) if i > 0]:
            canon[k] = ('restore', word)
    return canon


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--map', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'greekwords.json'),
                    help='JSON dict: de-accented lowercase word -> correct form')
    ap.add_argument('--dump-unresolved', default=None)
    ap.add_argument('--all', action='store_true', help='ignore the session-touched filter (legacy pass)')
    args = ap.parse_args()

    manual = {}
    if args.map:
        manual = {key_of(k): v for k, v in json.load(open(args.map)).items()}
    canon = canon_from(harvest(), manual)

    stats = collections.Counter()
    samples = []
    unresolved = collections.Counter()
    ambiguous = collections.Counter()

    for path in FILES:
        fname = path.split('/')[-1]
        data = json.load(open(path))
        head = json.loads(subprocess.run(['git', 'show', f'HEAD:frontend/src/i18n/locales/el/{fname}'],
                                         capture_output=True, text=True, cwd=REPO).stdout or '{}')
        head_vals = dict(walk(head))
        session_keys = {k for k, v in walk(data) if k not in head_vals or head_vals[k] != v}

        changed = {}
        for key, value in list(walk(data)):
            new = rule_a(value)
            if new != value:
                stats['rule_a_values'] += 1
            if args.all or key in session_keys:
                def fix(m):
                    w = m.group(0)
                    # capital-initial word, or a lowercase word that lost its tonos
                    capital = bool(re.match(r'^[Α-Ω][α-ω]+$', w))
                    if not (capital or re.match(r'^[α-ω]+$', w)):
                        return w
                    entry = canon.get(key_of(w))
                    if entry is None:
                        unresolved[w] += 1
                        return w
                    kind, form = entry
                    if kind == 'ambiguous':
                        ambiguous[w] += 1
                        return w
                    if len(w) < 3:                      # enclitic/short homographs (Τι, Κι, Πω)
                        return w
                    if form.lower().translate(DEACC) != w.lower():
                        return w
                    spots = base_accents(form)
                    if not spots:
                        return w
                    if capital and not [i for i, _ in spots if i > 0]:
                        return w                          # rule A owns the accent on a capital
                    fixed = (w[0] + form[1:]) if capital else form.lower()
                    if fixed != w:
                        stats['rule_b_words'] += 1
                        if len(samples) < 30:
                            samples.append((fname, key, w, fixed))
                        return fixed
                    return w
                fixed_text = WORD.sub(fix, new)
                if fixed_text != new:
                    stats['rule_b_values'] += 1
                    new = fixed_text
            if new != value:
                changed[key] = new
        for k, v in changed.items():
            set_by_path(data, k, v)
        if changed and args.write:
            with open(path, 'w') as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
                fh.write('\n')
        stats['values_rewritten'] += len(changed)

    print('DRY RUN' if not args.write else 'WRITTEN')
    print(f"  rule A (accent on a capital / inside an all-caps word): {stats['rule_a_values']} values")
    print(f"  rule B (tonos restored on capital-initial words):      {stats['rule_b_words']} words "
          f"in {stats['rule_b_values']} values")
    print(f"  total values rewritten:                                {stats['values_rewritten']}")
    print('\nsamples:')
    for s in samples:
        print('   ', s[0], s[1], f'{s[2]} -> {s[3]}')
    print(f'\nno attested pattern (left as typed): {sum(unresolved.values())} '
          f'({len(unresolved)} distinct), top: {unresolved.most_common(12)}')
    print(f'ambiguous patterns (left alone): {sum(ambiguous.values())} {ambiguous.most_common(8)}')
    if args.dump_unresolved:
        with open(args.dump_unresolved, 'w') as fh:
            for w, n in unresolved.most_common():
                fh.write(f'{n}\t{w}\t{w.lower().translate(DEACC)}\n')
        print('unresolved list ->', args.dump_unresolved)


if __name__ == '__main__':
    main()
