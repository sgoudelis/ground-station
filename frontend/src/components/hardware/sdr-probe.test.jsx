import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {ThemeProvider} from '@mui/material/styles';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {setupTheme} from '../../theme.js';
import '../../i18n/config.js';
import sdrReducer, {fetchSDRs, fetchSoapySDRServers, querySoapySDRServer, setFormValues, setOpenAddDialog} from './sdr-slice.jsx';
import tasksReducer, {taskStarted, taskCompleted} from '../tasks/tasks-slice.jsx';
import SDRsPage from './sdr-table.jsx';

const {socket} = vi.hoisted(() => ({socket: {emit: vi.fn(), timeout: vi.fn()}}));
vi.mock('../common/socket.jsx', () => ({useSocket: () => ({socket})}));
vi.mock('@mui/x-data-grid', () => ({DataGrid: ({rows, columns}) => <div>
    {rows.map((row) => <div key={row.id}>
        {row.name}{columns.find((column) => column.field === 'row_actions').renderCell({row})}
    </div>)}
</div>, gridClasses: {}}));

it('adds antenna ports from a dialog probe while preserving the name and custom labels', async () => {
    const store = configureStore({reducer: {
        sdrs: sdrReducer, backgroundTasks: () => ({tasks: {}}),
    }});
    store.dispatch(setFormValues({type: 'soapysdrremote', host: 'radio.local', port: 55132,
        driver: 'sdrplay', serial: 'ABC', name: 'Keep my name', antenna_labels: {rx: {A: 'Yagi'}}}));
    store.dispatch(setOpenAddDialog(true));
    let reply;
    socket.timeout.mockReturnValue(socket);
    socket.emit.mockImplementation((_event, request, callback) => {
        if (request.cmd === 'probe-sdr') reply = callback;
        else callback({success: true, data: {}});
    });
    render(<Provider store={store}><ThemeProvider theme={setupTheme('dark')}><SDRsPage/></ThemeProvider></Provider>);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toHaveValue('Keep my name');
    fireEvent.click(within(dialog).getByRole('button', {name: 'Probe selected SDR'}));
    await act(async () => reply(null, {success: true, data: {
        antennas: {rx: ['A', 'B'], tx: []}, sample_rate_values: [2000000], gain_values: [10],
    }}));
    expect(within(dialog).getByPlaceholderText('A')).toHaveValue('Yagi');
    expect(within(dialog).getByPlaceholderText('B')).toHaveValue('');
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toHaveValue('Keep my name');
    expect(store.getState().sdrs.formValues.antenna_labels.rx.A).toBe('Yagi');
});


it('probes the configured SDR directly from its table row', async () => {
    const store = configureStore({reducer: {
        sdrs: sdrReducer, backgroundTasks: () => ({tasks: {}}),
    }});
    const device = {id: 'radio', type: 'soapysdrremote', name: 'Configured receiver',
        host: 'radio.local', port: 55132, driver: 'sdrplay', serial: 'ABC'};
    store.dispatch(fetchSDRs.fulfilled([device], 'load'));
    socket.emit.mockClear();
    socket.timeout.mockReturnValue(socket);
    socket.emit.mockImplementation((_event, request, callback) => {
        if (request.cmd === 'probe-sdr') callback(null, {success: true, cached: true, data: {
            antennas: {rx: ['A'], tx: []}, sample_rate_values: [2000000], gain_values: [10],
        }});
        else callback({success: true, data: {}});
    });
    render(<Provider store={store}><ThemeProvider theme={setupTheme('dark')}><SDRsPage/></ThemeProvider></Provider>);
    expect(socket.emit.mock.calls.some((call) => call[1].cmd === 'probe-sdr')).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', {name: 'Probe Configured receiver'})).toBeEnabled());
    await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Probe Configured receiver'})));
    expect(screen.queryByRole('combobox', {name: 'Select SDR to probe'})).not.toBeInTheDocument();
    expect(screen.getByText('SDR is streaming. Showing cached capabilities.')).toBeInTheDocument();
    expect(store.getState().sdrs.sdrs).toEqual([device]);
});

it('probes a remote SDR immediately on selection, once per choice, using the selected connection', async () => {
    const store = configureStore({reducer: {
        sdrs: sdrReducer, backgroundTasks: () => ({tasks: {}}),
    }});
    store.dispatch(setFormValues({type: 'soapysdrremote', host: '', port: 55132,
        driver: '', serial: '', name: 'Choose a receiver', antenna_labels: {rx: {A: 'Yagi'}}}));
    store.dispatch(setOpenAddDialog(true));
    const probes = [];
    socket.emit.mockClear();
    socket.timeout.mockReturnValue(socket);
    socket.emit.mockImplementation((_event, request, callback) => {
        if (request.cmd === 'probe-sdr') probes.push({values: request.data, reply: callback});
        else callback({success: true, data: {remote: {
            ip: 'radio.local', port: 55132, name: 'Remote server', status: 'active', sdrs: [
                {driver: 'remote', 'remote:driver': 'sdrplay', serial: 'ABC', label: 'Radio A'},
                {driver: 'remote', 'remote:driver': 'rtlsdr', serial: 'DEF', label: 'Radio B'},
            ],
        }}});
    });
    render(<React.StrictMode><Provider store={store}><ThemeProvider theme={setupTheme('dark')}>
        <SDRsPage/>
    </ThemeProvider></Provider></React.StrictMode>);
    const dialog = screen.getByRole('dialog');
    expect(probes).toHaveLength(0);
    const serverDropdown = await within(dialog).findByRole('combobox', {name: 'SoapySDR Server'});
    expect(within(dialog).getByRole('combobox', {name: 'SDR Device'}))
        .toHaveTextContent('Select a SoapySDR server first');
    expect(within(dialog).getByRole('combobox', {name: 'SDR Device'}))
        .toHaveAttribute('aria-disabled', 'true');
    fireEvent.mouseDown(serverDropdown);
    fireEvent.click(screen.getByRole('option', {name: /Remote server/}));
    expect(probes).toHaveLength(0);
    fireEvent.mouseDown(within(dialog).getByRole('combobox', {name: 'SDR Device'}));
    fireEvent.click(screen.getByRole('option', {name: 'Radio A :: ABC'}));
    expect(probes).toHaveLength(1);
    expect(probes[0].values).toMatchObject({
        host: 'radio.local', port: 55132, driver: 'sdrplay', serial: 'ABC', name: 'Radio A',
    });
    expect(within(dialog).getByRole('button', {name: 'Probing SDR…'})).toBeDisabled();
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toBeDisabled();
    await act(async () => probes[0].reply(null, {success: true, data: {
        antennas: {rx: ['A', 'B'], tx: []}, sample_rate_values: [2000000], gain_values: [10],
    }}));
    expect(within(dialog).getByPlaceholderText('A')).toHaveValue('Yagi');
    expect(within(dialog).getByPlaceholderText('B')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', {name: 'Serial'}), {target: {value: 'MANUAL'}});
    expect(probes).toHaveLength(1);
    fireEvent.mouseDown(within(dialog).getByRole('combobox', {name: 'SDR Device'}));
    fireEvent.click(screen.getByRole('option', {name: 'Radio B :: DEF'}));
    expect(probes).toHaveLength(2);
    expect(probes[1].values).toMatchObject({host: 'radio.local', driver: 'rtlsdr', serial: 'DEF'});
    await act(async () => probes[1].reply(null, {success: false, error: 'Radio disconnected'}));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Radio disconnected');
    expect(probes).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', {name: 'Probe selected SDR'}));
    expect(probes).toHaveLength(3);
});

it.each([false, true])('starts discovery on remote type selection unless a scan is already running (%s)', async (running) => {
    const store = configureStore({reducer: {
        sdrs: sdrReducer, backgroundTasks: tasksReducer,
    }});
    const scan = {task_id: 'scan', name: 'SoapySDR Discovery'};
    if (running) store.dispatch(taskStarted(scan));
    store.dispatch(setOpenAddDialog(true));
    const discoveries = [];
    socket.emit.mockClear();
    socket.emit.mockImplementation((_event, request, callback) => {
        if (request.cmd === 'background-task.start') discoveries.push({request, reply: callback});
        else callback({success: true, data: {}});
    });
    render(<React.StrictMode><Provider store={store}><ThemeProvider theme={setupTheme('dark')}>
        <SDRsPage/>
    </ThemeProvider></Provider></React.StrictMode>);
    const dialog = screen.getByRole('dialog');
    expect(discoveries).toHaveLength(0);
    await waitFor(() => expect(within(dialog).getByRole('combobox', {name: 'SDR Type'}))
        .not.toHaveAttribute('aria-disabled', 'true'));
    fireEvent.mouseDown(within(dialog).getByRole('combobox', {name: 'SDR Type'}));
    fireEvent.click(screen.getByRole('option', {name: 'SoapySDR Remote'}));
    expect(store.getState().sdrs.formValues.type).toBe('soapysdrremote');
    expect(discoveries).toHaveLength(running ? 0 : 1);
    expect(within(dialog).getByRole('button', {name: 'Discovering…'})).toBeDisabled();
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toBeDisabled();
    expect(within(dialog).getByRole('combobox', {name: 'SDR Type'})).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByRole('combobox', {name: 'SDR Device'})).toBeVisible();
    if (!running) {
        expect(discoveries[0].request.data).toMatchObject({task_name: 'soapysdr_discovery', kwargs: {mode: 'single'}});
        await act(async () => {
            store.dispatch(taskStarted(scan));
            discoveries[0].reply({success: true, task_id: 'scan'});
        });
    }
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toBeDisabled();
    expect(within(dialog).getByRole('combobox', {name: 'SDR Type'})).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByRole('button', {name: 'Submit'})).toBeDisabled();
    expect(within(dialog).getByRole('button', {name: 'Cancel'})).toBeEnabled();
    await act(async () => store.dispatch(taskCompleted({...scan, status: 'completed', return_code: 0})));
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toBeEnabled();
    expect(within(dialog).getByRole('combobox', {name: 'SDR Type'})).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByRole('combobox', {name: 'SDR Device'})).toHaveTextContent('No SDR devices available');
    expect(within(dialog).getByRole('combobox', {name: 'SDR Device'})).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(within(dialog).getByRole('textbox', {name: 'Name'}), {target: {value: 'My radio'}});
    expect(discoveries).toHaveLength(running ? 0 : 1);
});

it.each([false, true])('queries a manual server and retains its devices after discovery refresh (other servers: %s)', async (hasDiscoveredServer) => {
    const store = configureStore({reducer: {sdrs: sdrReducer, backgroundTasks: tasksReducer}});
    const discovered = {found: {ip: 'radio.local', port: 55132, name: 'Discovered server', sdrs: [
        {driver: 'remote', 'remote:driver': 'sdrplay', serial: 'FOUND', label: 'Discovered radio'},
    ]}};
    store.dispatch(setFormValues({type: 'soapysdrremote', host: '', port: 55132, driver: '', serial: ''}));
    store.dispatch(setOpenAddDialog(true));
    const queries = [], probes = [];
    socket.timeout.mockReturnValue(socket);
    socket.emit.mockImplementation((_event, request, reply) => {
        if (request.cmd === 'query-soapy-server') queries.push({request, reply});
        else if (request.cmd === 'probe-sdr') probes.push({request, reply});
        else reply({success: true, data: hasDiscoveredServer ? discovered : {}});
    });
    render(<React.StrictMode><Provider store={store}><ThemeProvider theme={setupTheme('dark')}>
        <SDRsPage/>
    </ThemeProvider></Provider></React.StrictMode>);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('combobox', {name: 'SoapySDR Server'}))
        .not.toHaveAttribute('aria-disabled', 'true'));
    fireEvent.mouseDown(within(dialog).getByRole('combobox', {name: 'SoapySDR Server'}));
    fireEvent.click(screen.getByRole('option', {name: 'Enter server manually…'}));
    expect(within(dialog).getByRole('spinbutton', {name: 'Port'})).toHaveValue(55132);
    fireEvent.change(within(dialog).getByRole('textbox', {name: 'Server hostname or IP address'}),
        {target: {value: ' radio.local '}});
    fireEvent.change(within(dialog).getByRole('spinbutton', {name: 'Port'}), {target: {value: '55133'}});
    expect(queries).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', {name: 'Query server'}));
    expect(queries).toHaveLength(1);
    expect(queries[0].request.data).toEqual({host: 'radio.local', port: 55133});
    expect(probes).toHaveLength(0);
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toBeDisabled();
    expect(within(dialog).getByRole('button', {name: 'Querying server…'})).toBeDisabled();
    expect(within(dialog).getByRole('combobox', {name: 'SDR Device'})).toHaveTextContent('Querying server…');
    const manual = {ip: 'radio.local', port: 55133, name: 'radio.local', status: 'active', sdrs: [
        {driver: 'remote', 'remote:driver': 'rtlsdr', serial: 'MANUAL', label: 'Manual radio'},
    ]};
    await act(async () => queries[0].reply(null, {success: true, data: manual}));
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toBeEnabled();
    // A fresh mDNS snapshot must not erase devices queried directly by endpoint.
    await act(async () => store.dispatch(fetchSoapySDRServers.fulfilled({}, 'refresh')));
    fireEvent.mouseDown(within(dialog).getByRole('combobox', {name: 'SDR Device'}));
    fireEvent.click(screen.getByRole('option', {name: 'Manual radio :: MANUAL'}));
    expect(probes).toHaveLength(1);
    expect(probes[0].request.data).toMatchObject({host: 'radio.local', port: 55133, driver: 'rtlsdr', serial: 'MANUAL'});
    await act(async () => probes[0].reply(null, {success: true, data: {antennas: {rx: ['A'], tx: []}}}));
    expect(within(dialog).getByPlaceholderText('A')).toBeInTheDocument();
    expect(store.getState().sdrs.sdrs).toEqual([]);
    if (hasDiscoveredServer) {
        await act(async () => store.dispatch(fetchSoapySDRServers.fulfilled(discovered, 'refresh')));
        fireEvent.mouseDown(within(dialog).getByRole('combobox', {name: 'SoapySDR Server'}));
        fireEvent.click(screen.getByRole('option', {name: /Discovered server/}));
        expect(within(dialog).queryByRole('spinbutton', {name: 'Port'})).not.toBeInTheDocument();
        expect(store.getState().sdrs.formValues.port).toBe(55132);
        fireEvent.mouseDown(within(dialog).getByRole('combobox', {name: 'SDR Device'}));
        expect(screen.getByRole('option', {name: 'Discovered radio :: FOUND'})).toBeInTheDocument();
        expect(screen.queryByRole('option', {name: 'Manual radio :: MANUAL'})).not.toBeInTheDocument();
    }
}, 10000);

it('allows retry after server errors, empty results, and acknowledgment timeouts', async () => {
    const store = configureStore({reducer: {sdrs: sdrReducer, backgroundTasks: tasksReducer}});
    store.dispatch(setFormValues({type: 'soapysdrremote', host: 'missing.example.org', port: 55132}));
    store.dispatch(setOpenAddDialog(true));
    const queries = [];
    socket.timeout.mockReturnValue(socket);
    socket.emit.mockImplementation((_event, request, reply) => {
        if (request.cmd === 'query-soapy-server') queries.push(reply);
        else reply({success: true, data: {}});
    });
    render(<Provider store={store}><ThemeProvider theme={setupTheme('dark')}><SDRsPage/></ThemeProvider></Provider>);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', {name: 'Query server'})).toBeEnabled());
    fireEvent.click(within(dialog).getByRole('button', {name: 'Query server'}));
    await act(async () => queries[0](null, {success: false, error: 'Could not connect to the server.'}));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not connect to the server.');
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', {name: 'Query server'}));
    await act(async () => queries[1](null, {success: true, data: {
        ip: 'missing.example.org', port: 55132, name: 'missing.example.org', status: 'active', sdrs: [],
    }}));
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', {name: 'SDR Device'})).toHaveTextContent('No SDR devices available');
    fireEvent.click(within(dialog).getByRole('button', {name: 'Query server'}));
    await act(async () => queries[2](new Error('ack timeout')));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Server query timed out');
    expect(within(dialog).getByRole('button', {name: 'Query server'})).toBeEnabled();
    expect(within(dialog).getByRole('textbox', {name: 'Server hostname or IP address'})).toHaveValue('missing.example.org');
});

it('does not apply a late server query to another dialog connection', async () => {
    const store = configureStore({reducer: {sdrs: sdrReducer, backgroundTasks: tasksReducer}});
    store.dispatch(setFormValues({type: 'soapysdrremote', host: 'old.example.org', port: 55132}));
    store.dispatch(setOpenAddDialog(true));
    let respond;
    socket.timeout.mockReturnValue(socket);
    socket.emit.mockImplementation((_event, request, reply) => {
        if (request.cmd === 'query-soapy-server') respond = reply;
        else reply({success: true, data: {}});
    });
    render(<Provider store={store}><ThemeProvider theme={setupTheme('dark')}><SDRsPage/></ThemeProvider></Provider>);
    await waitFor(() => expect(screen.getByRole('button', {name: 'Query server'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: 'Query server'}));
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
    await act(async () => {
        store.dispatch(setFormValues({host: 'new.example.org', driver: '', serial: ''}));
        store.dispatch(setOpenAddDialog(true));
    });
    await act(async () => respond(null, {success: true, data: {
        ip: 'old.example.org', port: 55132, name: 'Old server', status: 'active',
        sdrs: [{driver: 'rtlsdr', serial: 'OLD'}],
    }}));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('textbox', {name: 'Server hostname or IP address'})).toHaveValue('new.example.org');
    expect(within(dialog).getByRole('combobox', {name: 'SDR Device'})).toHaveTextContent('No SDR devices available');
    expect(store.getState().sdrs.formValues.driver).toBe('');
});

it('adds a discovered device from its server and automatically probes the selected connection', async () => {
    const store = configureStore({reducer: {sdrs: sdrReducer, backgroundTasks: tasksReducer}});
    store.dispatch(fetchSDRs.fulfilled([
        {id: 'saved', type: 'soapysdrremote', host: 'radio.local', port: 55132, driver: 'rtlsdr', serial: 'ABC', name: 'Saved radio'},
        {id: 'usb', type: 'soapysdrlocal', driver: 'rtlsdr', serial: 'DEF', name: 'Local radio'},
    ], 'load'));
    store.dispatch(querySoapySDRServer.fulfilled({ip: 'radio.local', port: 55133, name: 'Manual server', status: 'active',
        sdrs: [{driver: 'remote', 'remote:driver': 'rtlsdr', serial: 'ABC', label: 'Other server radio'}]}, 'manual'));
    const servers = {found: {ip: 'radio.local', port: 55132, name: 'rfbox5', status: 'active', sdrs: [
        {driver: 'remote', 'remote:driver': 'rtlsdr', serial: 'ABC', label: 'Configured receiver'},
        {driver: 'remote', 'remote:driver': 'rtlsdr', serial: 'DEF', label: 'New receiver'},
    ]}};
    const probes = [];
    socket.timeout.mockReturnValue(socket);
    socket.emit.mockImplementation((_event, request, reply) => {
        if (request.cmd === 'probe-sdr') probes.push({request, reply});
        else reply({success: true, data: servers});
    });
    render(<Provider store={store}><ThemeProvider theme={setupTheme('dark')}><SDRsPage/></ThemeProvider></Provider>);
    const panel = screen.getByRole('region', {name: 'Remote SoapySDR servers'});
    fireEvent.click(await within(panel).findByRole('button', {name: /rfbox5/}));
    expect(within(panel).getByText('Configured')).toBeVisible();
    expect(within(panel).queryByRole('button', {name: 'Add Configured receiver'})).not.toBeInTheDocument();
    expect(within(panel).getByText('Manual')).toBeVisible();
    fireEvent.click(within(panel).getByRole('button', {name: /Manual server/}));
    expect(within(panel).getByRole('button', {name: 'Add Other server radio'})).toBeVisible();
    fireEvent.click(within(panel).getByRole('button', {name: 'Add New receiver'}));
    const dialog = screen.getByRole('dialog', {name: 'Add SDR'});
    expect(probes).toHaveLength(1);
    expect(probes[0].request.data).toMatchObject({type: 'soapysdrremote', host: 'radio.local', port: 55132,
        driver: 'rtlsdr', serial: 'DEF', name: 'New receiver'});
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toBeDisabled();
    await act(async () => probes[0].reply(null, {success: true, data: {antennas: {rx: ['RX'], tx: []}}}));
    expect(within(dialog).getByRole('textbox', {name: 'Name'})).toHaveValue('New receiver');
    expect(within(dialog).getByPlaceholderText('RX')).toBeInTheDocument();
    expect(store.getState().sdrs.sdrs).toHaveLength(2);
});

it('opens manual server entry directly from the server panel without starting a network scan', async () => {
    const store = configureStore({reducer: {sdrs: sdrReducer, backgroundTasks: tasksReducer}});
    socket.emit.mockClear();
    socket.emit.mockImplementation((_event, _request, reply) => reply({success: true, data: {}}));
    render(<Provider store={store}><ThemeProvider theme={setupTheme('dark')}><SDRsPage/></ThemeProvider></Provider>);
    const panel = screen.getByRole('region', {name: 'Remote SoapySDR servers'});
    await waitFor(() => expect(within(panel).getByRole('button', {name: 'Enter server manually…'})).toBeEnabled());
    fireEvent.click(within(panel).getByRole('button', {name: 'Enter server manually…'}));
    const dialog = screen.getByRole('dialog', {name: 'Add SDR'});
    expect(within(dialog).getByRole('textbox', {name: 'Server hostname or IP address'})).toHaveValue('');
    expect(within(dialog).getByRole('spinbutton', {name: 'Port'})).toHaveValue(55132);
    expect(within(dialog).getByRole('button', {name: 'Query server'})).toBeDisabled();
    expect(socket.emit.mock.calls.every(([, request]) => request.cmd === 'get-soapy-servers')).toBe(true);
});
