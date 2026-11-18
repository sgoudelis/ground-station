#!/usr/bin/env python3
"""Move label-bearing MUI <Button> usages onto <CapsButton>.

Why: MUI buttons are `text-transform: uppercase`, but Greek disables CSS uppercasing app-wide
(src/theme.js) because CSS keeps the tonos and paints invalid all-caps. A plain <Button> therefore
renders whatever case the locale file stores, so `ΑΚΥΡΩΣΗ` sits next to `Απενεργοποίηση`.
<CapsButton> (src/components/common/capsbutton.jsx) supplies the capitals in JS instead.

Rules (kept deliberately conservative):
  * wrap only blocks whose children contain a translation call (t(/label( - including dynamically
    chosen keys such as label(readOnly ? 'close' : 'cancel'))
  * never wrap self-closing tags (no children) or `component=` buttons (link-shaped: caps is wrong)
  * buttons whose child is data (row.name, frequencies) have no translation call and stay plain
  * inside a wrapped block, drop a label-level `textTransform: 'none'` (it opted the label out of
    the very capitalisation we are restoring); data buttons keep theirs

Run from `frontend/`:  python3 scripts/capscodemod.py [--dry]
Idempotent: already-wrapped buttons are not matched again.
"""
import argparse, pathlib, re, subprocess, sys

SRC = pathlib.Path('src')
COMMON = pathlib.Path('src/components/common')
TRANSLATION = re.compile(r'\b(?:t|label|satellitesT|settingsT|tx)\s*\(')


def tag_end(text, start):
    """Index just past the `>` that closes the tag beginning at `start`.

    A plain `find('>')` is wrong: `sx={(theme) => …}` inside an attribute carries `=>`. Track brace,
    bracket and paren depth plus string state and take the first depth-0 `>`.
    """
    depth = 0
    quote = None
    i = start
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in '"\'`':
            quote = ch
        elif ch in '({[':
            depth += 1
        elif ch in ')}]':
            depth -= 1
        elif ch == '>' and depth == 0:
            return i + 1
        i += 1
    return -1


def strip_opt_out(fragment):
    """Remove a label-level caps opt-out, whole-line form first (leaves no blank line behind)."""
    out, removed = fragment, 0
    if "textTransform: 'none'," in out:
        out, n = re.subn(r'[ \t]*textTransform: \'none\',\n', '\n', out)
        removed += n
    for token in ("textTransform: 'none',", 'textTransform: "none",', "textTransform: 'none'", 'textTransform: "none"'):
        if token in out:
            out = out.replace(token, '')
            removed += 1
    return out, removed


def import_line_for(path):
    """Relative import of the wrapper, e.g. src/components/settings/x.jsx -> ../common/capsbutton.jsx."""
    try:
        rel = path.relative_to('src/components')
    except ValueError:
        # Outside src/components (rare): fall back to a path measured from the file's directory.
        depth = len(path.parts) - 1
        return f"import CapsButton from '{'../' * depth}components/common/capsbutton.jsx';"
    depth = len(rel.parts) - 1
    if rel.parts[0] == 'common':
        return "import CapsButton from './capsbutton.jsx';"
    return f"import CapsButton from '{'../' * depth}common/capsbutton.jsx';"


def migrate(path, write):
    src = path.read_text()
    if '<Button' not in src:
        return 0, 0
    out, pos, wrapped, optouts = [], 0, 0, 0
    for m in re.finditer(r'<Button\b', src):
        if m.start() < pos:
            continue
        end = tag_end(src, m.start())
        if end == -1:
            continue
        tag = src[m.start():end]
        if tag.rstrip().endswith('/>'):          # self-closing: no children to cap
            continue
        close = src.find('</Button>', end)
        if close == -1:
            continue
        body = src[end:close]
        if 'component=' in tag or not TRANSLATION.search(body):
            continue
        new_tag, removed_tag = strip_opt_out(tag.replace('<Button', '<CapsButton', 1))
        new_body, removed_body = (body, 0)
        if "textTransform: 'none'" in body:
            new_body, removed_body = strip_opt_out(body)
        out.append(src[pos:m.start()] + new_tag + new_body + '</CapsButton>')
        pos = close + len('</Button>')
        wrapped += 1
        optouts += removed_tag + removed_body
    if not wrapped:
        return 0, 0
    out.append(src[pos:])
    text = ''.join(out)
    if 'capsbutton.jsx' not in text:
        anchor = None
        for candidate in re.finditer(r"^import .*(?:@mui/material|react-i18next).*;$", text, re.M):
            anchor = candidate
        line = import_line_for(path)
        text = (text.replace(anchor.group(0), anchor.group(0) + '\n' + line, 1) if anchor
                else line + '\n' + text)
    # A fully migrated file no longer references the plain MUI Button.
    if not re.search(r'<Button\b', text):
        def prune(match):
            names = [n.strip() for n in match.group(1).split(',')]
            if 'Button' not in names:
                return match.group(0)
            names = [n for n in names if n != 'Button']
            return f"import {{{','.join(names)}}} from '@mui/material';" if names else ''
        text = re.sub(r"import \{([^}]*)\} from '@mui/material';", prune, text, count=1)
    head = subprocess.run(['git', 'show', f'HEAD:frontend/{path}'], capture_output=True, text=True).stdout
    if head and not re.search(r'(?m)^[ \t]+$', head):
        text = re.sub(r'(?m)^[ \t]+$\n', '', text)
    if write:
        path.write_text(text)
    return wrapped, optouts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true', help='report without writing')
    args = ap.parse_args()
    total = optouts = 0
    for path in sorted(SRC.rglob('*.jsx')):
        if '__tests__' in str(path) or str(path).startswith('src/components/scheduler'):
            continue
        wrapped, removed = migrate(path, not args.dry)
        if wrapped:
            total += wrapped
            optouts += removed
            print(f'{path}: wrapped {wrapped}, dropped {removed} caps opt-out(s)')
    print(f'{"would wrap" if args.dry else "wrapped"} {total} buttons, dropped {optouts} opt-outs')
    return 0


if __name__ == '__main__':
    sys.exit(main())
