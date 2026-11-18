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

import React from 'react';
import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { capsLabel } from '../../utils/greekcaps.js';

/**
 * MUI `Button` that capitalises its label in JS for Greek.
 *
 * MUI buttons are `text-transform: uppercase`. Greek opts out of CSS uppercasing app-wide
 * (`src/theme.js`) because CSS keeps the tonos and paints invalid all-caps (`ΡΥΘΜΙΣΕΊΣ`) - the
 * side effect was that a Greek button simply rendered whatever case the locale file stores, so
 * `ΑΚΥΡΩΣΗ` and `Απενεργοποίηση` sat next to each other. `<CapsButton>` restores the caps by
 * building the label through `capsLabel`, the same mechanism `AntTab` already uses.
 *
 * Use it for buttons whose child is a translated label. Leave the plain MUI `Button` in place for
 * buttons that render *data* (satellite names, frequencies, counts): those are not labels, and the
 * ones that deliberately set `textTransform: 'none'` must keep using it.
 */
function capChildren(children, i18nInstance) {
    // String child: the whole label is capped, exactly like the CSS would.
    if (typeof children === 'string') return capsLabel(children, i18nInstance);
    // Icon + label buttons pass an array; cap the text nodes and leave elements (icons, spinners).
    if (Array.isArray(children)) return children.map((child) => capChildren(child, i18nInstance));
    // A label can also sit inside a wrapper element (`<Stack><Typography>{t(...)}</Typography></Stack>`,
    // MUI's `<Translate>`). Clone so nested label text caps too. Buttons whose content is *data*
    // (satellite names, frequencies) are deliberately left as plain MUI buttons by convention, so
    // anything reaching this branch inside a CapsButton is chrome text.
    if (React.isValidElement(children)) {
        const nested = children.props?.children;
        if (nested === undefined || nested === null || typeof nested === 'function') return children;
        return React.cloneElement(children, {}, capChildren(nested, i18nInstance));
    }
    return children;
}

const CapsButton = React.forwardRef(function CapsButton({ children, ...props }, ref) {
    // The instance comes from the render tree on purpose: greekcaps.js must not import the app's
    // i18n singleton (it would break tests that mock react-i18next), and a mocked useTranslation
    // without an i18n simply leaves the label alone.
    const translation = useTranslation();
    const i18n = translation?.i18n;
    return (
        <Button ref={ref} {...props}>
            {capChildren(children, i18n)}
        </Button>
    );
});

export default CapsButton;
