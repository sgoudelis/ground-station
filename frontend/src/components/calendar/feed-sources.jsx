import {Box, Link, Stack, Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';

// Credit each publisher once across RSS languages and categories. Both calendar
// settings and About use this list to keep upstream acknowledgements consistent.
const announcementSources = [
    {name: 'ARISS', url: 'https://www.ariss.org/'},
    {name: 'ARISS International (Mastodon)', url: 'https://mastodon.hams.social/@ARISS_Intl'},
    {name: 'AMSAT', url: 'https://www.amsat.org/'},
    {name: 'AMSAT-UK', url: 'https://amsat-uk.org/'},
    {name: 'AMSAT-DL', url: 'https://amsat-dl.org/'},
    {name: 'AMSAT-F', url: 'https://site.amsat-f.org/'},
    {name: 'JAMSAT', url: 'https://www.jamsat.or.jp/'},
    {name: 'R4UAB', url: 'https://r4uab.ru/'},
];

export default function CalendarFeedSources({headingComponent = 'h3'}) {
    const {t} = useTranslation('calendar');
    const groups = [
        {label: t('attribution.announcements'), sources: announcementSources},
        {label: t('attribution.weather'), sources: [
            {name: 'NOAA Space Weather Prediction Center (SWPC)', url: 'https://www.swpc.noaa.gov/'},
        ]},
        {label: t('attribution.launches'), sources: [
            {name: 'Launch Library 2 · The Space Devs', url: 'https://thespacedevs.com/llapi'},
        ]},
    ];

    return <Box component="section" aria-label={t('attribution.title')}>
        <Typography component={headingComponent} variant="subtitle2">{t('attribution.title')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{mt: 0.5, mb: 1.5, lineHeight: 1.6}}>
            {t('attribution.introduction')}
        </Typography>
        <Stack spacing={1.5}>
            {groups.map(({label, sources}) => <Box key={label}>
                <Typography variant="body2" fontWeight={600} sx={{mb: 0.5}}>{label}</Typography>
                <Box component="ul" sx={{display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5,
                    listStyle: 'none', p: 0, m: 0}}>
                    {sources.map(({name, url}) => <Box component="li" key={url}>
                        <Link href={url} target="_blank" rel="noopener noreferrer" variant="body2" underline="hover">
                            {name}
                        </Link>
                    </Box>)}
                </Box>
            </Box>)}
        </Stack>
    </Box>;
}
