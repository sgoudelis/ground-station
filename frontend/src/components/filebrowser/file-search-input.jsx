/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
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

import React, { useEffect, useRef, useState } from 'react';
import { IconButton, InputAdornment, TextField } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

export default function FileSearchInput({ value, onChange }) {
    const { t } = useTranslation('filebrowser');
    const [draft, setDraft] = useState(value);
    const timer = useRef(null);
    const input = useRef(null);

    useEffect(() => setDraft(value), [value]);

    useEffect(() => {
        if (draft === value) return;
        timer.current = window.setTimeout(() => onChange(draft), 300);
        return () => window.clearTimeout(timer.current);
    }, [draft, value, onChange]);

    const applySearch = (next) => {
        // Enter and Clear must cancel the debounce so it cannot restore old text.
        window.clearTimeout(timer.current);
        setDraft(next);
        onChange(next);
        input.current?.focus();
    };

    return (
        <TextField
            type="search"
            inputRef={input}
            size="small"
            label={t('search.label', 'Search files')}
            placeholder={t('search.placeholder', 'Search filenames, satellites, NORAD IDs…')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    applySearch(draft);
                }
                if (event.key === 'Escape') applySearch('');
            }}
            slotProps={{
                htmlInput: { maxLength: 512 },
                input: {
                    startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                    endAdornment: draft ? (
                        <InputAdornment position="end">
                            <IconButton size="small" aria-label={t('search.clear', 'Clear search')} onClick={() => applySearch('')}>
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </InputAdornment>
                    ) : null,
                },
            }}
            sx={{
                flex: 1,
                minWidth: 0,
                '& input::-webkit-search-cancel-button': { display: 'none' },
            }}
        />
    );
}
