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

import i18n from '../i18n/config.js';

/**
 * All-caps Greek orthography for strings that UI chrome paints in capitals.
 *
 * A Greek word written entirely in capitals carries no accent marks: `ΡΥΘΜΙΣΕΙΣ`,
 * never `ΡΥΘΜΊΣΕΊΣ`. CSS `text-transform: uppercase` cannot express that - it keeps
 * the tonos on the capitals - so components that insist on capitals build the label
 * through this helper instead (stored locale strings stay correctly accented).
 */

const ACUTE = /\u0301/g; // combining acute (tonos/oxia) after NFD decomposition

/**
 * Upper-case `text` and drop every tonos, matching how Greek is written in all caps.
 * The dialytika on ΰ/ΐ is preserved (they become Ϋ/Ϊ, not Υ/Ι) and a final sigma still
 * maps to Σ. Non-strings (React nodes, undefined labels) pass through untouched.
 */
export function greekCaps(text) {
    if (typeof text !== 'string' || text.length === 0) {
        return text;
    }
    return text.normalize('NFD').replace(ACUTE, '').normalize('NFC').toUpperCase();
}

/**
 * True when the active language is Greek, i.e. when capitalised labels need the
 * accent-stripping treatment. Call it while rendering: the app remounts on language
 * change (see the `app-provider-${language}` key in App.jsx), so a read is enough.
 */
export function isGreekLocale(i18nInstance) {
    const lang = i18nInstance?.resolvedLanguage || i18nInstance?.language;
    return typeof lang === 'string' && lang.split('-')[0] === 'el';
}

/**
 * Capitalise a MUI tab label the way the tab CSS does - in JS when the language is
 * Greek, because all-caps Greek has no tonos and CSS cannot remove it. Every other
 * language returns the label untouched and still relies on `text-transform: uppercase`.
 */
export function tabCapsLabel(label) {
    return isGreekLocale(i18n) ? greekCaps(label) : label;
}
