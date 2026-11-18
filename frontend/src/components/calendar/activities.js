// Both color and text identify an activity; color is never the only cue.
export const ACTIVITY_COLORS = {
    observation: '#7f9ec4',
    sstv: '#9b8bea', voice: '#5eafdf', digipeater: '#51b49a',
    transponder: '#d9a64e', telemetry: '#d583a9',
    ssdv: '#a28bd2', voice_contact: '#5eafdf', audio: '#d583a9',
    broadcast: '#d2a35a', other_radio: '#849aa6',
};

export function activityLabels(t) {
    return {
        observation: t('types.observation'),
        sstv: t('types.sstv'), digipeater: t('types.digipeater'),
        transponder: t('types.transponder'), telemetry: t('types.telemetry'),
        ssdv: t('types.ssdv'), voice_contact: t('types.voice'), audio: t('types.audio'),
        broadcast: t('types.broadcast'), other_radio: t('types.other_radio'),
    };
}
