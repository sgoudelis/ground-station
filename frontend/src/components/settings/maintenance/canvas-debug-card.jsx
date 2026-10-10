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
import { Typography, Divider } from '@mui/material';
import Grid from '@mui/material/Grid';
import { useTranslation } from 'react-i18next';

const CanvasDebugCard = () => {
    const { t } = useTranslation('settings');
    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('canvas_debug_card.canvas_rendering_debug_information', { defaultValue: 'Canvas Rendering Debug Information' })}
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('canvas_debug_card.information_about_canvas_rendering_environment_for_debug', { defaultValue: 'Information about canvas rendering environment for debugging text distortion issues' })}
            </Typography>

            <Grid container spacing={2} columns={16}>
                <Grid size={16}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        {t('canvas_debug_card.display_information', { defaultValue: 'Display Information' })}
                    </Typography>
                    <Divider sx={{ mb: 1 }} />
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.device_pixel_ratio', { defaultValue: 'Device Pixel Ratio' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.scale_factor_between_css_pixels_and_physical_pixels', { defaultValue: 'Scale factor between CSS pixels and physical pixels' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="h6" color="primary">
                        {window.devicePixelRatio || 'N/A'}
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.window_inner_dimensions', { defaultValue: 'Window Inner Dimensions' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.viewport_width_and_height_in_css_pixels', { defaultValue: 'Viewport width and height in CSS pixels' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {window.innerWidth} × {window.innerHeight} px
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.screen_resolution', { defaultValue: 'Screen Resolution' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.physical_screen_dimensions', { defaultValue: 'Physical screen dimensions' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {window.screen.width} × {window.screen.height} px
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.available_screen_space', { defaultValue: 'Available Screen Space' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.screen_size_minus_os_toolbars_taskbar', { defaultValue: 'Screen size minus OS toolbars/taskbar' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {window.screen.availWidth} × {window.screen.availHeight} px
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.color_depth', { defaultValue: 'Color Depth' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.bits_per_pixel_for_color_representation', { defaultValue: 'Bits per pixel for color representation' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {window.screen.colorDepth} bits
                    </Typography>
                </Grid>

                <Grid size={16}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 2 }}>
                        {t('canvas_debug_card.browser_information', { defaultValue: 'Browser Information' })}
                    </Typography>
                    <Divider sx={{ mb: 1 }} />
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.user_agent', { defaultValue: 'User Agent' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.browser_identification_string', { defaultValue: 'Browser identification string' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                        {navigator.userAgent}
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.platform', { defaultValue: 'Platform' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.operating_system_platform', { defaultValue: 'Operating system platform' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {navigator.platform}
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.language', { defaultValue: 'Language' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.browser_language_setting', { defaultValue: 'Browser language setting' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {navigator.language}
                    </Typography>
                </Grid>

                <Grid size={16}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 2 }}>
                        {t('canvas_debug_card.hardware_information', { defaultValue: 'Hardware Information' })}
                    </Typography>
                    <Divider sx={{ mb: 1 }} />
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.hardware_concurrency', { defaultValue: 'Hardware Concurrency' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.number_of_logical_processor_cores', { defaultValue: 'Number of logical processor cores' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {navigator.hardwareConcurrency || 'N/A'} cores
                    </Typography>
                </Grid>

                <Grid size={8}>
                    {t('canvas_debug_card.max_touch_points', { defaultValue: 'Max Touch Points' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('canvas_debug_card.maximum_simultaneous_touch_points_supported', { defaultValue: 'Maximum simultaneous touch points supported' })}
                    </Typography>
                </Grid>
                <Grid size={8}>
                    <Typography variant="body1">
                        {navigator.maxTouchPoints || 0}
                    </Typography>
                </Grid>
            </Grid>
        </>
    );
};

export default CanvasDebugCard;
