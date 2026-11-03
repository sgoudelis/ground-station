import { describe, expect, it } from 'vitest';
import { createFlowFromMetrics, preserveNodePositions } from '../flow-layout.js';

describe('decoder browser connections', () => {
    const observationSession = 'internal:obs-123:sdr-1';

    const createGraph = (decoders) => createFlowFromMetrics({
        sdrs: { 'sdr-1': { decoders } },
        sessions: {
            'browser-1': { session_id: 'browser-1', client_ip: '192.168.1.1' },
            'browser-2': { session_id: 'browser-2', client_ip: '192.168.1.2' },
        },
        audio_streamers: {
            'web_audio_browser-1': {
                session_id: 'browser-1',
                stats: {},
                rates: {},
            },
        },
    });

    const getBrowserEdges = (graph, decoderKey) => {
        const decoder = graph.nodes.find(node => node.data.component.decoder_id === decoderKey);
        return graph.edges.filter(edge => edge.source === decoder.id &&
            graph.nodes.find(node => node.id === edge.target)?.data.type === 'browser');
    };

    const getBrowserSessions = (graph, edges) => edges.map(edge =>
        graph.nodes.find(node => node.id === edge.target).data.component.session_id
    ).sort();

    it('connects every observation VFO to all connected browsers through one output handle', () => {
        const decoders = Object.fromEntries([1, 2, 3].map(vfo => {
            const key = `${observationSession}_vfo${vfo}`;
            return [key, {
                type: vfo === 1 ? 'SSTVDecoder' : 'GMSKDecoder',
                session_id: observationSession,
                decoder_id: key,
                vfo_number: vfo,
                rates: { data_messages_out_per_sec: 1 },
            }];
        }));
        const graph = createGraph(decoders);

        Object.keys(decoders).forEach(key => {
            const edges = getBrowserEdges(graph, key);
            expect(getBrowserSessions(graph, edges)).toEqual(['browser-1', 'browser-2']);
            expect(edges.every(edge => edge.animated)).toBe(true);
            expect(edges.map(edge => edge.sourceHandle)).toEqual(['output-0', 'output-0']);
        });
    });

    it('connects user decoders only to their owning browser', () => {
        const decoders = Object.fromEntries(['browser-1', 'browser-2', 'disconnected-browser'].map(session => {
            const key = `${session}_vfo1`;
            return [key, { type: 'GMSKDecoder', session_id: session, decoder_id: key }];
        }));
        const graph = createGraph(decoders);

        expect(getBrowserSessions(graph, getBrowserEdges(graph, 'browser-1_vfo1'))).toEqual(['browser-1']);
        expect(getBrowserSessions(graph, getBrowserEdges(graph, 'browser-2_vfo1'))).toEqual(['browser-2']);
        expect(getBrowserEdges(graph, 'disconnected-browser_vfo1')).toEqual([]);
    });

    it('keeps observation connections visible when no decoder messages are flowing', () => {
        const key = `${observationSession}_vfo1`;
        const graph = createGraph({
            [key]: {
                type: 'SSTVDecoder',
                session_id: observationSession,
                decoder_id: key,
                rates: { data_messages_out_per_sec: 0 },
            },
        });
        const edges = getBrowserEdges(graph, key);

        expect(getBrowserSessions(graph, edges)).toEqual(['browser-1', 'browser-2']);
        expect(edges.every(edge => !edge.animated)).toBe(true);
    });
});

describe('preserveNodePositions', () => {
    it('keeps manually positioned nodes in place while applying fresh metric data', () => {
        const currentNodes = [
            { id: 'worker', position: { x: 640, y: 120 }, data: { rate: 1 } },
            { id: 'decoder', position: { x: 920, y: 360 }, data: { rate: 2 } },
        ];
        const nextNodes = [
            { id: 'worker', position: { x: 50, y: 50 }, data: { rate: 3 } },
            { id: 'decoder', position: { x: 250, y: 50 }, data: { rate: 4 } },
            { id: 'new-node', position: { x: 450, y: 50 }, data: { rate: 5 } },
        ];

        const nodes = preserveNodePositions(nextNodes, currentNodes);

        expect(nodes).toEqual([
            { id: 'worker', position: { x: 640, y: 120 }, data: { rate: 3 } },
            { id: 'decoder', position: { x: 920, y: 360 }, data: { rate: 4 } },
            { id: 'new-node', position: { x: 450, y: 50 }, data: { rate: 5 } },
        ]);
    });
});
