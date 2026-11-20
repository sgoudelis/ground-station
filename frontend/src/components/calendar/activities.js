// Both color and text identify an activity; color is never the only cue.
export const ACTIVITY_COLORS = {
    observation: '#3b82f6', space_weather: '#ea580c', launch: '#0891b2',
    sstv: '#8b5cf6', voice: '#16a34a', digipeater: '#0d9488',
    transponder: '#ca8a04', telemetry: '#4f46e5',
    ssdv: '#d946ef', voice_contact: '#16a34a', audio: '#db2777',
    broadcast: '#dc2626', other_radio: '#64748b',
};

export function activityLabels(t) {
    return {
        observation: t('types.observation'),
        space_weather: t('types.space_weather'), launch: t('types.launch'),
        sstv: t('types.sstv'), digipeater: t('types.digipeater'),
        transponder: t('types.transponder'), telemetry: t('types.telemetry'),
        ssdv: t('types.ssdv'), voice_contact: t('types.voice'), audio: t('types.audio'),
        broadcast: t('types.broadcast'), other_radio: t('types.other_radio'),
    };
}
