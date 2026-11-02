export const frequencyBands = [
    {
        startFrequency: 1800000,
        endFrequency: 2000000,
        name: '160m Ham',
        color: 'rgba(255, 0, 0, 0.3)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 3500000,
        endFrequency: 4000000,
        name: '80m Ham',
        color: 'rgba(255, 50, 0, 0.3)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 7000000,
        endFrequency: 7300000,
        name: '40m Ham',
        color: 'rgba(255, 100, 0, 0.3)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 10100000,
        endFrequency: 10150000,
        name: '30m Ham',
        color: 'rgba(255, 150, 0, 0.3)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 14000000,
        endFrequency: 14350000,
        name: '20m Ham',
        color: 'rgba(255, 200, 0, 0.3)',
        textColor: '#000000'
    },
    {
        startFrequency: 18068000,
        endFrequency: 18168000,
        name: '17m Ham',
        color: 'rgba(200, 255, 0, 0.3)',
        textColor: '#000000'
    },
    {
        startFrequency: 21000000,
        endFrequency: 21450000,
        name: '15m Ham',
        color: 'rgba(150, 255, 0, 0.3)',
        textColor: '#000000'
    },
    {
        startFrequency: 24890000,
        endFrequency: 24990000,
        name: '12m Ham',
        color: 'rgba(100, 255, 0, 0.3)',
        textColor: '#000000'
    },
    {
        startFrequency: 28000000,
        endFrequency: 29700000,
        name: '10m Ham',
        color: 'rgba(0, 255, 100, 0.3)',
        textColor: '#000000'
    },
    {
        startFrequency: 144000000,
        endFrequency: 146000000,
        name: '2m Ham',
        color: 'rgba(255, 0, 0, 0.3)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 430000000,
        endFrequency: 440000000,
        name: '70cm Ham',
        color: 'rgba(0, 255, 0, 0.3)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 88000000,
        endFrequency: 108000000,
        name: 'FM Broadcast',
        color: 'rgba(0, 0, 255, 0.3)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 433000000,
        endFrequency: 434000000,
        name: '433 ISM',
        color: 'rgba(0, 0, 255, 0.3)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 446000000,
        endFrequency: 446200000,
        name: 'PMR446',
        color: 'rgba(255, 193, 7, 0.3)',
        textColor: '#000000'
    },
    {
        startFrequency: 868000000,
        endFrequency: 868600000,
        name: '868 ISM',
        color: 'rgba(156, 39, 176, 0.3)',
        textColor: '#ffffff'
    },
    // Meshtastic regional tuning ranges: https://meshtastic.org/docs/configuration/radio/lora/
    {
        startFrequency: 433000000,
        endFrequency: 434000000,
        name: 'Meshtastic EU433',
        color: 'rgba(0, 188, 212, 0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 869400000,
        endFrequency: 869650000,
        name: 'Meshtastic EU868',
        color: 'rgba(0, 188, 212, 0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 902000000,
        endFrequency: 928000000,
        name: 'Meshtastic US/Canada',
        color: 'rgba(255, 152, 0, 0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 915000000,
        endFrequency: 928000000,
        name: 'Meshtastic Australia/NZ',
        color: 'rgba(255, 193, 7, 0.4)',
        textColor: '#000000'
    },
    {
        startFrequency: 865000000,
        endFrequency: 867000000,
        name: 'Meshtastic India',
        color: 'rgba(0, 200, 83, 0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 920500000,
        endFrequency: 923500000,
        name: 'Meshtastic Japan',
        color: 'rgba(33, 150, 243, 0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 225000000,
        endFrequency: 350000000,
        name: 'MIL SATCOM',
        color: 'rgba(218,28,180,0.47)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1518000000,
        endFrequency: 1525000000,
        name: 'Inmarsat L-band (uplink)',
        color: 'rgba(63,81,181,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1525000000,
        endFrequency: 1559000000,
        name: 'Inmarsat L-band (downlink)',
        color: 'rgba(33,150,243,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1626000000,
        endFrequency: 1660000000,
        name: 'Inmarsat L-band (uplink)',
        color: 'rgba(3,169,244,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 406000000,
        endFrequency: 406100000,
        name: 'SARSAT 406 MHz (Distress beacon uplink)',
        color: 'rgba(255,61,0,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1544000000,
        endFrequency: 1545000000,
        name: 'SARSAT L-band downlink',
        color: 'rgba(255,152,0,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1549000000,
        endFrequency: 1550000000,
        name: 'SARSAT L-band downlink (alt)',
        color: 'rgba(255,152,0,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 2483000000,
        endFrequency: 2487000000,
        name: 'SARSAT S-band downlink (GEOSAR/MEOSAR)',
        color: 'rgba(244,67,54,0.4)',
        textColor: '#ffffff'
    },
    // GNSS ranges below follow current signal specs/reference RF envelopes.
    {
        startFrequency: 1560075000,
        endFrequency: 1590765000,
        name: 'GPS L1',
        color: 'rgba(0,200,83,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1212255000,
        endFrequency: 1242945000,
        name: 'GPS L2',
        color: 'rgba(0,121,255,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1598062500,
        endFrequency: 1605375000,
        name: 'GLONASS L1',
        color: 'rgba(255,152,0,0.4)',
        textColor: '#000000'
    },
    {
        startFrequency: 1559052000,
        endFrequency: 1563044000,
        name: 'BeiDou B1I',
        color: 'rgba(139,195,74,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1559052000,
        endFrequency: 1591788000,
        name: 'BeiDou B1C',
        color: 'rgba(124,179,66,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1616000000,
        endFrequency: 1626000000,
        name: 'Iridium L-band',
        color: 'rgba(121,85,72,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1560075000,
        endFrequency: 1590765000,
        name: 'QZSS L1',
        color: 'rgba(0,150,136,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1610000000,
        endFrequency: 1618725000,
        name: 'Globalstar uplink',
        color: 'rgba(103,58,183,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 2483500000,
        endFrequency: 2500000000,
        name: 'Globalstar downlink',
        color: 'rgba(156,39,176,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 137000000,
        endFrequency: 138000000,
        name: 'Orbcomm/Weather Sat downlink',
        color: 'rgba(96,125,139,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 148000000,
        endFrequency: 150050000,
        name: 'Orbcomm uplink',
        color: 'rgba(120,144,156,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 137100000,
        endFrequency: 137912500,
        name: 'NOAA APT',
        color: 'rgba(33,150,243,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1691000000,
        endFrequency: 1691000000,
        name: 'GOES/Meteosat HRIT/LRIT',
        color: 'rgba(3,169,244,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 145800000,
        endFrequency: 146000000,
        name: 'Amateur Sat downlink',
        color: 'rgba(244,67,54,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 435000000,
        endFrequency: 438000000,
        name: 'Amateur Sat downlink',
        color: 'rgba(233,30,99,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 121500000,
        endFrequency: 121500000,
        name: 'Emergency 121.5 MHz',
        color: 'rgba(255,87,34,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1090000000,
        endFrequency: 1090000000,
        name: 'ADS-B (Aircraft)',
        color: 'rgba(0,188,212,0.4)',
        textColor: '#ffffff'
    },
    {
        startFrequency: 1563144000,
        endFrequency: 1587696000,
        name: 'Galileo E1',
        color: 'rgba(63,81,181,0.4)',
        textColor: '#ffffff'
    }
];
