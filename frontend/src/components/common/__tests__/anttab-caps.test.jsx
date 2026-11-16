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
 * Guards the wiring, not the orthography: Greek tab labels must reach the DOM as
 * accents-removed capitals, because Greek opts out of CSS uppercase transforms.
 */

import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it } from 'vitest';

import i18n from '../../../i18n/config.js';
import { setupTheme } from '../../../theme.js';
import { AntTab, AntTabs } from '../common.jsx';

// AntTab/AntTabs read custom palette tokens (palette.border.*), so they need the app theme.
const renderTabs = (label) => render(
    <ThemeProvider theme={setupTheme('dark')}>
        <AntTabs value="settings" onChange={() => {}}>
            <AntTab value="settings" label={label} />
        </AntTabs>
    </ThemeProvider>,
);

describe('AntTab label capitalisation', () => {
    afterEach(async () => {
        await i18n.changeLanguage('en');
    });

    it('renders Greek labels in capitals without the tonos', async () => {
        await i18n.changeLanguage('el');
        renderTabs('Συγχρονισμός τροχιών');
        expect(screen.getByRole('tab').textContent).toBe('ΣΥΓΧΡΟΝΙΣΜΟΣ ΤΡΟΧΙΩΝ');
    });

    it('leaves other languages for the CSS transform', async () => {
        await i18n.changeLanguage('de');
        renderTabs('Einstellungen');
        expect(screen.getByRole('tab').textContent).toBe('Einstellungen');
    });
});
