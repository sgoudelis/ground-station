// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

export const getTransmitterBand = (frequencyHz) => {
    const freqMHz = frequencyHz / 1000000;
    if (freqMHz >= 30 && freqMHz < 300) return 'vhf';
    if (freqMHz >= 300 && freqMHz < 1000) return 'uhf';
    if (freqMHz >= 1000 && freqMHz < 2000) return 'l_band';
    if (freqMHz >= 2000 && freqMHz < 4000) return 's_band';
    if (freqMHz >= 4000 && freqMHz < 8000) return 'c_band';
    if (freqMHz >= 8000 && freqMHz < 12000) return 'x_band';
    if (freqMHz < 30) return 'hf';
    return 'other';
};
