/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import React, { useState } from 'react';
import {
    Button, Dialog, DialogActions, DialogContent, Link, Stack,
} from '@mui/material';
import FavoriteBorderOutlinedIcon from '@mui/icons-material/FavoriteBorderOutlined';
import { useTranslation } from 'react-i18next';
import FeedbackDisclosure, { FeedbackChoices } from '../settings/feedback-disclosure.jsx';
import WizardSection from './section.jsx';

export default function FeedbackStep({ enabled, onChange }) {
    const { t } = useTranslation('settings');
    const [detailsOpen, setDetailsOpen] = useState(false);

    return (
        <WizardSection
            icon={FavoriteBorderOutlinedIcon}
            title={t('feedback.title')}
            description={t('feedback.wizard_summary')}
        >
            <Stack spacing={2} alignItems="flex-start">
                <FeedbackChoices enabled={enabled} onChange={onChange} />
                <Link component="button" type="button" variant="body2" aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>
                    {t('feedback.wizard_details')}
                </Link>
            </Stack>
            <Dialog
                open={detailsOpen}
                onClose={() => setDetailsOpen(false)}
                fullWidth
                maxWidth="md"
                scroll="paper"
                aria-label={t('feedback.title')}
            >
                <DialogContent dividers>
                    {/* Reuse the complete notice and share the wizard's unsaved choice. */}
                    <FeedbackDisclosure enabled={enabled} onChange={onChange} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDetailsOpen(false)}>{t('common:close')}</Button>
                </DialogActions>
            </Dialog>
        </WizardSection>
    );
}
