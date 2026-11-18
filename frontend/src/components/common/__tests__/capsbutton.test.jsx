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
 * Greek opts out of CSS `text-transform` (see src/theme.js), so a plain MUI button would paint
 * whatever case the locale file stores. <CapsButton> supplies the capitals in JS instead, the way
 * AntTab already does for tab strips.
 */

import { render, screen } from '@testing-library/react';
import DeleteIcon from '@mui/icons-material/Delete';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { afterEach, describe, expect, it } from 'vitest';

import i18n from '../../../i18n/config.js';
import CapsButton from '../capsbutton.jsx';

describe('CapsButton label capitalisation', () => {
    afterEach(async () => {
        await i18n.changeLanguage('en');
    });

    it('renders a Greek label in capitals without the tonos', async () => {
        await i18n.changeLanguage('el');
        render(<CapsButton>Ακύρωση</CapsButton>);
        // The accessible name follows the visible text, so it is capped too (deliberate).
        expect(screen.getByRole('button', { name: 'ΑΚΥΡΩΣΗ' })).toBeInTheDocument();
    });

    it('leaves every other language to the CSS transform', async () => {
        await i18n.changeLanguage('de');
        render(<CapsButton>Löschen</CapsButton>);
        expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
    });

    it('caps the text node of an icon + label button and keeps the icon', async () => {
        await i18n.changeLanguage('el');
        render(<CapsButton startIcon={<DeleteIcon data-testid="icon" />}>Διαγραφή</CapsButton>);
        expect(screen.getByRole('button', { name: 'ΔΙΑΓΡΑΦΗ' })).toBeInTheDocument();
        expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('passes every other button prop through to MUI', async () => {
        const calls = [];
        render(
            <CapsButton variant="outlined" color="error" disabled onClick={() => calls.push(1)}>
                OK
            </CapsButton>,
        );
        const button = screen.getByRole('button', { name: 'OK' });
        expect(button).toBeDisabled();
        expect(button.className).toContain('MuiButton-outlinedError');
    });

    it('caps a label nested inside wrapper elements', async () => {
        // Many dialog and scheduler buttons wrap the label in Box/Stack/Typography (or MUI's
        // Translate), so the transform has to reach inside element children, not just bare strings.
        await i18n.changeLanguage('el');
        render(
            <CapsButton>
                <Box component="span">
                    <Typography component="span">Ακύρωση</Typography>
                </Box>
            </CapsButton>,
        );
        expect(screen.getByRole('button', { name: 'ΑΚΥΡΩΣΗ' })).toBeInTheDocument();
    });

    it('keeps icons while capping a nested label', async () => {
        await i18n.changeLanguage('el');
        render(
            <CapsButton startIcon={<DeleteIcon data-testid="icon" />}>
                <Typography component="span">Αποθήκευση</Typography>
            </CapsButton>,
        );
        expect(screen.getByTestId('icon')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ΑΠΟΘΗΚΕΥΣΗ' })).toBeInTheDocument();
    });
});
