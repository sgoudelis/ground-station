import {describe, expect, it} from 'vitest';
import {render, screen, within} from '@testing-library/react';
import {ThemeProvider} from '@mui/material/styles';
import {setupTheme} from '../../../theme.js';
import {themeConfigs} from '../../../themes/theme-configs.js';
import HardwareStatusIndicator from '../hardware-status-indicator.jsx';
import HardwareControlHeader from '../../dashboard/hardware-control-header.jsx';
import StatusOverlay from '../status-overlay.jsx';

describe('shared operational language', () => {
    it('shows connection and motion independently while a command is pending', () => {
        render(<ThemeProvider theme={setupTheme()}>
            <HardwareControlHeader kind="rotator" device={{name: 'Mount', host: 'localhost', port: 4533}}
                connectionStatus="connected" status="slewing" lastUpdateAge={0}
                command={{action: 'stop', status: 'started'}} />
        </ThemeProvider>);
        expect(screen.getByLabelText('Rotator: Connected')).toHaveAttribute('data-tone', 'active');
        expect(screen.getByLabelText('Rotator: Slewing')).toHaveAttribute('data-tone', 'busy');
        expect(screen.getByRole('status')).toHaveTextContent('Stopping…');
    });

    it('distinguishes pausing automatic frequency updates from a physical rotator stop', () => {
        render(<ThemeProvider theme={setupTheme()}>
            <HardwareStatusIndicator kind="rotator" status="stopped" />
            <HardwareStatusIndicator kind="rig" status="stopped" />
        </ThemeProvider>);
        expect(within(screen.getByLabelText('Rotator: Stopped')).getByTestId('StopIcon')).toBeInTheDocument();
        expect(within(screen.getByLabelText('Rig: Paused')).getByTestId('PauseIcon')).toBeInTheDocument();
    });

    it('describes a rig stop command as pausing frequency updates', () => {
        render(<ThemeProvider theme={setupTheme()}>
            <HardwareControlHeader kind="rig" device={{name: 'Radio'}} connectionStatus="connected"
                status="tracking" lastUpdateAge={0} command={{action: 'stop', status: 'started'}} />
        </ThemeProvider>);
        expect(screen.getByRole('status')).toHaveTextContent('Pausing tracking…');
        expect(screen.getByLabelText('Rig: Tracking')).toBeInTheDocument();
    });

    it('distinguishes recording, notifications, and faults by shape and meaning', () => {
        render(<ThemeProvider theme={setupTheme()}>
            <StatusOverlay type="recording" /><StatusOverlay type="new" /><StatusOverlay type="error" />
        </ThemeProvider>);
        expect(screen.getByLabelText('Recording')).toHaveAttribute('data-tone', 'active');
        expect(within(screen.getByLabelText('Recording')).getByTestId('RadioButtonCheckedIcon')).toBeInTheDocument();
        expect(screen.getByLabelText('New files')).toHaveAttribute('data-tone', 'busy');
        expect(screen.getByLabelText('Error')).toHaveAttribute('data-tone', 'fault');
        expect(within(screen.getByLabelText('Error')).getByTestId('ErrorOutlineIcon')).toBeInTheDocument();
    });

    it.each(Object.keys(themeConfigs))('preserves the operational palette in the %s theme', (name) => {
        const theme = setupTheme(name);
        const reference = setupTheme(theme.palette.mode === 'dark' ? 'dark' : 'light');
        expect(theme.palette.operational).toEqual(reference.palette.operational);
        expect(new Set(Object.values(theme.palette.operational).map(role => role.main)).size).toBe(5);
    });
});
