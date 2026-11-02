import { describe, expect, it } from 'vitest';
import { mapOutputsToRows, resolveDecodedAssetUrl } from '../decoded-packets-drawer.jsx';

const packet = (timestamp) => ({
    id: `output_${timestamp}`,
    type: 'decoder-output',
    timestamp,
    decoder_type: 'gmsk',
    output: {
        callsigns: {},
    },
});

describe('mapOutputsToRows', () => {
    const meshtastic = (values = {}, status = 'decoded') => ({
        ...packet(1), decoder_type: 'lora', output: {
            satellite: {norad_id: 12345, name: 'Locked satellite'},
            telemetry: {parser_id: 'meshtastic', payload_status: status,
                headers: {meshtastic: {source: '!bd5029dc', destination: 'Broadcast'}},
                telemetry: {source: '!bd5029dc', values},
            },
        },
    });

    it.each([
        [{long_name: ' Sv2tca-1 ', short_name: '29dc'}, 'Sv2tca-1'],
        [{long_name: ' ', short_name: '29dc'}, '29dc'],
        [{message: 'Hello mesh'}, '!bd5029dc'],
        [{long_name: '', short_name: ''}, '!bd5029dc'],
    ])('uses the Meshtastic sender name or node address for From: %j', (values, sender) => {
        expect(mapOutputsToRows([meshtastic(values)])[0]).toMatchObject({
            from: sender, to: 'Broadcast', fromIsSatelliteHint: false, fromSatelliteNoradId: null,
        });
    });

    it.each(['unsupported', 'malformed'])('keeps the Meshtastic header address for %s payloads', (status) => {
        expect(mapOutputsToRows([meshtastic({long_name: 'Unusable name'}, status)])[0]).toMatchObject({
            from: '!bd5029dc', fromIsSatelliteHint: false,
        });
    });

    it('can read a Meshtastic sender from normalized records without legacy telemetry', () => {
        const output = meshtastic();
        delete output.output.telemetry.telemetry;
        delete output.output.telemetry.headers;
        output.output.telemetry.payload = {records: [{source: '!bd5029dc', destination: 'Broadcast',
            groups: [{values: {long_name: 'SV2TCA'}}],
        }]};
        expect(mapOutputsToRows([output])[0]).toMatchObject({from: 'SV2TCA', to: 'Broadcast'});
        output.output.telemetry.payload.records[0].groups = [];
        expect(mapOutputsToRows([output])[0].from).toBe('!bd5029dc');
    });

    it('retains a decoded callsign and does not infer a Meshtastic name from satellite payloads', () => {
        const output = meshtastic({long_name: 'Mesh name'});
        output.output.callsigns = {from: 'SV2TEST', to: 'GROUND'};
        expect(mapOutputsToRows([output])[0]).toMatchObject({from: 'SV2TEST', to: 'GROUND'});
        delete output.output.callsigns;
        output.output.telemetry.parser_id = 'tianqi';
        expect(mapOutputsToRows([output])[0]).toMatchObject({from: '(Locked satellite)', fromIsSatelliteHint: true});
    });

    it('keeps the newest live packets when history exceeds the visible limit', () => {
        // The decoder store is newest-first, matching decoderOutputReceived.
        const newestFirstOutputs = Array.from({ length: 100 }, (_, index) => packet(100 - index));

        const rows = mapOutputsToRows(newestFirstOutputs, 50);

        expect(rows).toHaveLength(50);
        expect(rows.map((row) => row.timestamp / 1000)).toEqual(
            Array.from({ length: 50 }, (_, index) => 100 - index),
        );
    });

    it('keeps the full retained history and newest arrivals first when timestamps match', () => {
        const newestFirstOutputs = Array.from({length: 100}, (_, index) => ({
            ...packet(100 - index),
            timestamp: 100,
        }));
        expect(mapOutputsToRows(newestFirstOutputs).map((row) => row.id))
            .toEqual(newestFirstOutputs.map((output) => output.id));
    });

    it('shows the available LoRa PHY settings beside SF and bandwidth', () => {
        const rows = mapOutputsToRows([{
            ...packet(1),
            decoder_type: 'lora',
            vfo: 2,
            output: {
                callsigns: {},
                parameters: 'SF8, BW 125 kHz',
                decoder_config: {
                    cr: 1,
                    sync_word: [0x34],
                    implicit_header: false,
                    has_crc: true,
                    ldro_mode: 2,
                    invert_iq: true,
                },
            },
        }]);

        expect(rows[0].parameters).toBe(
            'SF8 · BW 125 kHz · CR 4/5 · Sync 0x34 · Explicit header · CRC cfg on · LDRO auto · IQ inverted',
        );
        expect(rows[0].vfo).toBe(2);
    });

    it('keeps existing parameter text when LoRa configuration is unavailable', () => {
        const rows = mapOutputsToRows([{
            ...packet(1),
            decoder_type: 'lora',
            output: { callsigns: {}, parameters: 'SF7, BW 125 kHz' },
        }]);

        expect(rows[0].parameters).toBe('SF7 · BW 125 kHz');
    });

    it('shows the locked satellite as a LoRa From hint only when no callsign was decoded', () => {
        const loraOutput = {
            ...packet(1),
            decoder_type: 'lora',
            output: { callsigns: {}, satellite: { norad_id: 12345, name: 'TinyGS Sat' } },
        };

        expect(mapOutputsToRows([loraOutput])[0]).toMatchObject({
            from: '(TinyGS Sat)',
            fromIsSatelliteHint: true,
            fromSatelliteNoradId: 12345,
            to: '-',
            satelliteName: 'TinyGS Sat',
            noradId: 12345,
        });
        expect(mapOutputsToRows([{ ...loraOutput, output: { callsigns: {} } }])[0].from).toBe('-');
        expect(mapOutputsToRows([{
            ...loraOutput,
            output: { ...loraOutput.output, callsigns: { from: 'DECODED', to: 'GROUND' } },
        }])[0]).toMatchObject({ from: 'DECODED', fromIsSatelliteHint: false, fromSatelliteNoradId: null, to: 'GROUND' });
        expect(mapOutputsToRows([{
            ...loraOutput,
            decoder_type: 'gmsk',
        }])[0].from).toBe('-');
    });
});

describe('resolveDecodedAssetUrl', () => {
    it('preserves serial and UTC reception run directories', () => {
        expect(resolveDecodedAssetUrl('data/decoded/radiosonde_RS41_TEST0042/20261101T103000.000000Z.gssonde/packet.bin', 'packet.bin'))
            .toBe('/decoded/radiosonde_RS41_TEST0042/20261101T103000.000000Z.gssonde/packet.bin');
    });
    it('routes scheduled decoder artifacts through their observation bundle', () => {
        const filepath = '/opt/ground-station/backend/data/observations/ISS Pass.gsobs/decoded/aprs packet.json';

        expect(resolveDecodedAssetUrl(filepath, 'aprs packet.json')).toBe(
            '/observations/ISS%20Pass.gsobs/decoded/aprs%20packet.json',
        );
    });

    it('routes manual decoder artifacts through the shared decoded directory', () => {
        const filepath = 'data/decoded/aprs_1200baud_20260731_213604_054488.json';

        expect(resolveDecodedAssetUrl(filepath, 'fallback.json')).toBe(
            '/decoded/aprs_1200baud_20260731_213604_054488.json',
        );
    });

    it('falls back to the emitted filename for older decoder messages', () => {
        expect(resolveDecodedAssetUrl(undefined, 'packet name.json')).toBe(
            '/decoded/packet%20name.json',
        );
    });
});
