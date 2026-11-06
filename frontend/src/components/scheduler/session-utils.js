import { getSdrCaptureBandwidth, isSdrBandwidthUnavailable } from '../common/sdr-parameters.js';

export const createEmptySdrSession = (sampleRate = 2000000) => ({
    sdr: {
        id: '',
        name: '',
        sample_rate: sampleRate,
        gain: '',
        antenna_port: '',
        center_frequency: 0,
        auto_center_frequency: true,
        bias_t: false,
        tuner_agc: false,
        rtl_agc: false,
        soapy_agc: false,
        sdr_settings: {},
    },
    tasks: [],
});

export const getSessions = (item) => (Array.isArray(item?.sessions) ? item.sessions : []);

export const getFlattenedTasks = (item) =>
    getSessions(item).flatMap((session) => (Array.isArray(session?.tasks) ? session.tasks : []));

export const getSessionSdrs = (item) =>
    getSessions(item)
        .map((session) => session?.sdr)
        .filter(Boolean);

const getTaskFrequencyDetails = (session, transmitters) =>
    (session?.tasks || []).flatMap((task, taskIndex) => {
        const transmitter = transmitters.find((entry) => entry.id === task.config?.transmitter_id);
        if (!transmitter?.downlink_low) return [];
        return [{
            taskIndex, name: transmitter.description, freq: transmitter.downlink_low,
            bandwidth: transmitter.downlink_high ? transmitter.downlink_high - transmitter.downlink_low : 0,
        }];
    });

const getFrequencySpan = (details) => {
    const minFreq = details.length ? Math.min(...details.map((entry) => entry.freq - entry.bandwidth / 2)) : 0;
    const maxFreq = details.length ? Math.max(...details.map((entry) => entry.freq + entry.bandwidth / 2)) : 0;
    return { minFreq, maxFreq, requiredBandwidth: maxFreq - minFreq };
};

export const calculateSdrCenterFrequency = (session, transmitters, device, parameters) => {
    const details = getTaskFrequencyDetails(session, transmitters);
    if (!details.length) return 0;
    const { minFreq, maxFreq, requiredBandwidth } = getFrequencySpan(details);
    const captureBandwidth = getSdrCaptureBandwidth(session.sdr, device, parameters);
    // Avoid DC where possible, but never shift a fitting task span out of the filter.
    const dcOffset = Math.min(captureBandwidth / 4, Math.max(0, (captureBandwidth - requiredBandwidth) / 2));
    return Math.round((minFreq + maxFreq) / 2 + dcOffset);
};

export const validateSdrTaskBandwidth = (session, transmitters, sdrs, parametersById, t) => {
    const sdr = session?.sdr || {};
    const sampleRate = Number(sdr.sample_rate);
    if (!sampleRate) return { valid: true, message: '', details: [] };
    const device = sdrs.find((entry) => String(entry.id) === String(sdr.id));
    const parameters = parametersById[sdr.id];
    const captureBandwidth = getSdrCaptureBandwidth(sdr, device, parameters);
    const unavailable = isSdrBandwidthUnavailable(sdr, device, parameters);
    const details = getTaskFrequencyDetails(session, transmitters)
        .map((entry) => ({ ...entry, name: entry.name || t('unknown') }));
    const { minFreq, maxFreq, requiredBandwidth } = getFrequencySpan(details);
    const filterSelected = sdr.sdr_settings?.bandwidth != null && sdr.sdr_settings.bandwidth !== 'driver';
    // A narrow filter must also cover the tasks at the selected center frequency.
    const outsideFilter = filterSelected && details.length > 0 && sdr.center_frequency > 0
        && (minFreq < sdr.center_frequency - captureBandwidth / 2
            || maxFreq > sdr.center_frequency + captureBandwidth / 2);
    const valid = !unavailable && !outsideFilter && requiredBandwidth <= captureBandwidth;
    const message = valid ? '' : unavailable
        ? t('waterfall:sdr.if_bandwidth_unavailable')
        : outsideFilter || captureBandwidth < sampleRate
            ? t('waterfall:sdr.if_bandwidth_tasks_outside')
            : t('scheduler_dialogs.shared.bandwidth_validation_error', {
                required: (requiredBandwidth / 1000000).toFixed(2),
                sampleRate: (sampleRate / 1000000).toFixed(2),
            });
    return { valid, message, details, minFreq, maxFreq, requiredBandwidth, sampleRate };
};
