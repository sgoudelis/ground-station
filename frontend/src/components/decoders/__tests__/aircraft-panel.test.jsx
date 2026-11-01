import React from 'react';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import AircraftPanel from '../aircraft-panel.jsx';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
vi.mock('../../common/socket.jsx', () => ({useSocket: () => ({socket: null})}));
vi.mock('../use-aircraft.js', () => ({default: () => ({aircraft: [
    {icao: '4d2406', callsign: 'EWG46A'},
    {icao: '46b825', callsign: 'GREEK'},
    {icao: 'ffffff', callsign: 'UNKNOWN'},
], error: null})}));

it('shows registration flags beside ICAO addresses with country tooltips and leaves unknown flags empty', async () => {
    render(<ThemeProvider theme={createTheme()}><AircraftPanel /></ThemeProvider>);
    const maltese = screen.getByRole('row', {name: /4D2406/});
    const flag = within(maltese).getByRole('img', {name: 'ICAO registration country: Malta'});
    expect(flag).toHaveTextContent('🇲🇹');
    expect(within(screen.getByRole('row', {name: /46B825/})).getByRole('img')).toHaveTextContent('🇬🇷');
    expect(within(screen.getByRole('row', {name: /FFFFFF/})).queryByRole('img')).not.toBeInTheDocument();
    fireEvent.mouseOver(flag);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('ICAO registration country: Malta');
});
