/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import dagre from 'dagre';

/**
 * Truncate long IDs (UUIDs, session IDs) for display
 */
const truncateId = (id, length = 8) => {
    if (!id || typeof id !== 'string') return 'N/A';
    if (id.length <= length) return id;
    return id.substring(0, length) + '...';
};

/**
 * Truncate session ID in keys like "sessionid_vfoN" while preserving VFO number
 * Examples:
 *   "BZmMbeC-3ZDTEhz7AAAB_vfo1" -> "BZmMbeC-..._vfo1"
 *   "session123_vfo2" -> "session1..._vfo2"
 */
const truncateSessionVfoKey = (key, length = 8) => {
    if (!key || typeof key !== 'string') return 'N/A';

    // Check if key contains "_vfo" pattern
    const vfoMatch = key.match(/^(.+?)(_vfo\d+)$/);
    if (vfoMatch) {
        const sessionId = vfoMatch[1];
        const vfoPart = vfoMatch[2];

        if (sessionId.length > length) {
            return `${sessionId.substring(0, length)}...${vfoPart}`;
        }
        return key; // Session ID is short enough, return as-is
    }

    // No VFO pattern, just truncate normally
    return truncateId(key, length);
};

/**
 * Check if a component has recent activity (data is flowing)
 * For trackers: uses last_activity timestamp to avoid sampling issues
 * For other components: uses rate values
 */
const hasPositiveOutputRate = (component, componentType = null) => {
    if (!component) return false;

    // Special case for trackers: use last_activity timestamp
    // This handles the 2s tracker loop properly
    if (componentType === 'tracker' && component.stats && component.stats.last_activity !== undefined) {
        const now = Date.now() / 1000; // Convert to seconds (Unix timestamp)
        const lastActivity = component.stats.last_activity;
        const timeSinceActivity = now - lastActivity;

        // Consider active if last_activity was within last 5 seconds
        return timeSinceActivity < 5;
    }

    // For all other components: use rate checking
    if (!component.rates) return false;

    const rates = component.rates;
    return (rates.messages_in_per_sec > 0) ||
           (rates.messages_broadcast_per_sec > 0) ||
           (rates.messages_received_per_sec > 0) ||
           (rates.iq_chunks_per_sec > 0) ||
           (rates.iq_chunks_in_per_sec > 0) ||
           (rates.samples_in_per_sec > 0) ||
           (rates.iq_samples_in_per_sec > 0) ||
           (rates.audio_chunks_out_per_sec > 0) ||
           (rates.audio_chunks_in_per_sec > 0) ||
           (rates.fft_results_per_sec > 0) ||
           (rates.messages_emitted_per_sec > 0) ||
           (rates.data_messages_out_per_sec > 0) ||
           (rates.samples_written_per_sec > 0) ||
           (rates.updates_per_sec > 0);
};

/**
 * Get edge color based on data type and queue health
 * @param {string} dataType - Type of data flowing through edge
 * @param {number} queueUtilization - Queue utilization percentage (0-1)
 * @param {boolean} isAnimated - Whether the edge is animated (has flow)
 */
const getEdgeColor = (dataType, queueUtilization = 0, isAnimated = true) => {
    // Base colors by data type
    const baseColors = {
        'iq': '#2196f3',        // Blue for IQ samples
        'audio': '#4caf50',     // Green for audio
        'decoded': '#ff9800',   // Orange for decoded data (morse, SSTV)
        'fft': '#9c27b0',       // Purple for FFT/waterfall
        'implicit': '#666',     // Gray for implicit connections
    };

    const baseColor = baseColors[dataType] || '#4caf50';

    // Apply queue health overlay (keep these bright for visibility)
    if (queueUtilization > 0.8) {
        return '#f44336'; // Critical - Red
    } else if (queueUtilization > 0.5) {
        return '#ff9800'; // Warning - Orange
    }

    // If not animated (no flow), make it dimmer
    if (!isAnimated) {
        // Convert hex to rgba with 0.3 opacity
        const hex = baseColor;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, 0.3)`;
    }

    return baseColor;
};

/**
 * Apply fresh metric data without discarding positions the user set manually.
 * Nodes which appear for the first time retain their generated default position.
 */
export const preserveNodePositions = (nextNodes, currentNodes) => {
    const positionsByNodeId = new Map(
        currentNodes.map(({ id, position }) => [id, position])
    );

    return nextNodes.map((node) => {
        const position = positionsByNodeId.get(node.id);
        return position ? { ...node, position } : node;
    });
};

/**
 * Apply Dagre layout with rank constraints to organize nodes hierarchically
 * @param {Array} nodes - ReactFlow nodes
 * @param {Array} edges - ReactFlow edges
 * @returns {Array} - Nodes with updated positions
 */
export const applyDagreLayout = (nodes, edges) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    // Configure graph layout
    dagreGraph.setGraph({
        rankdir: 'LR', // Left to right
        ranksep: 150,  // Horizontal spacing between ranks (nodes are 280px wide)
        nodesep: 40,   // Vertical spacing between nodes
        edgesep: 30,   // Spacing between edges
        ranker: 'tight-tree', // Use tight-tree for better rank constraint handling
    });

    // Define rank order for different node types
    const getRank = (node) => {
        const type = node.data.type;
        const componentType = node.data.component?.type;

        // Rank 0: SDR Workers and Trackers (leftmost - source of data)
        if (type === 'worker' || type === 'tracker') {
            return 0;
        }
        // Rank 1: IQ Recorders, IQ Broadcasters, and FFT Processors
        if (type === 'recorder' || (type === 'broadcaster' && node.data.component?.broadcaster_type === 'iq') || type === 'fft') {
            return 1;
        }
        // Rank 2: Demodulators, Decoders, and Audio Broadcasters
        if (type === 'demodulator' || type === 'decoder' || (type === 'broadcaster' && node.data.component?.broadcaster_type === 'audio')) {
            return 2;
        }
        // Rank 3: Audio Recorders, WebAudioStreamer and Transcription Consumer
        if (type === 'audio_recorder' || type === 'streamer' || type === 'transcription') {
            return 3;
        }
        // Rank 4: Browsers (rightmost)
        if (type === 'browser') {
            return 4;
        }

        return 10; // Default rank for unknown types
    };

    // Add nodes to dagre graph with rank constraints
    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, {
            width: 280,
            height: 200,
        });
    });

    // Add edges to dagre graph with minlen to enforce rank separation
    edges.forEach((edge) => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);

        if (sourceNode && targetNode) {
            const sourceRank = getRank(sourceNode);
            const targetRank = getRank(targetNode);
            const rankDiff = targetRank - sourceRank;

            // Set minlen based on rank difference to enforce hierarchy
            dagreGraph.setEdge(edge.source, edge.target, {
                minlen: Math.max(1, rankDiff)
            });
        } else {
            dagreGraph.setEdge(edge.source, edge.target);
        }
    });

    // Compute layout
    dagre.layout(dagreGraph);

    // Apply computed positions to nodes
    return nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        return {
            ...node,
            position: {
                x: nodeWithPosition.x - nodeWithPosition.width / 2,
                y: nodeWithPosition.y - nodeWithPosition.height / 2,
            },
        };
    });
};

/**
 * Convert performance metrics to ReactFlow nodes and edges
 */
export const createFlowFromMetrics = (metrics) => {
    const nodes = [];
    const edges = [];

    let nodeIdCounter = 0;
    const nodeMap = new Map(); // Track node IDs for creating edges

    // Track connection counts for each node
    const connectionCounts = new Map(); // nodeId -> { inputs: count, outputs: count }
    const nodeHandleCounters = new Map(); // nodeId -> { inputIndex: num, outputIndex: num }

    const initNodeConnections = (nodeId) => {
        if (!connectionCounts.has(nodeId)) {
            connectionCounts.set(nodeId, { inputs: 0, outputs: 0 });
            nodeHandleCounters.set(nodeId, { inputIndex: 0, outputIndex: 0 });
        }
    };

    const getNextInputHandle = (nodeId) => {
        initNodeConnections(nodeId);
        const counter = nodeHandleCounters.get(nodeId);
        const handleId = `input-${counter.inputIndex}`;
        counter.inputIndex++;
        return handleId;
    };

    const getNextOutputHandle = (nodeId) => {
        initNodeConnections(nodeId);
        const counter = nodeHandleCounters.get(nodeId);
        const handleId = `output-${counter.outputIndex}`;
        counter.outputIndex++;
        return handleId;
    };

    // Layout configuration - increased spacing to prevent overlap
    const HORIZONTAL_SPACING = 200;
    const VERTICAL_SPACING = 100;
    const START_X = 50;
    const START_Y = 50;

    // Process each SDR
    if (metrics.sdrs) {
        Object.entries(metrics.sdrs).forEach(([sdrId, sdrData], sdrIndex) => {
            const sdrStartY = START_Y + (sdrIndex * 1000); // Stack SDRs vertically
            let columnX = START_X;

            // Column 0: SDR Worker
            if (sdrData.worker) {
                const nodeId = `node-${nodeIdCounter++}`;
                nodeMap.set(`${sdrId}-worker`, nodeId);

                nodes.push({
                    id: nodeId,
                    type: 'componentNode',
                    position: { x: columnX, y: sdrStartY },
                    data: {
                        label: `SDR Worker - ${truncateId(sdrId)}`,
                        component: sdrData.worker,
                        type: 'worker',
                    },
                });
            }

            // Column 1: IQ Broadcaster
            columnX += HORIZONTAL_SPACING;
            if (sdrData.broadcasters) {
                Object.entries(sdrData.broadcasters).forEach(([broadcasterId, broadcaster]) => {
                    if (broadcaster.broadcaster_type === 'iq') {
                        const nodeId = `node-${nodeIdCounter++}`;
                        nodeMap.set(`${sdrId}-iq-broadcaster`, nodeId);

                        nodes.push({
                            id: nodeId,
                            type: 'componentNode',
                            position: { x: columnX, y: sdrStartY },
                            data: {
                                label: `IQ Broadcaster - ${truncateId(sdrId)}`,
                                component: broadcaster,
                                type: 'broadcaster',
                            },
                        });

                        // Edge: Worker -> IQ Broadcaster
                        const workerId = nodeMap.get(`${sdrId}-worker`);
                        if (workerId && sdrData.worker) {
                            const isAnimated = hasPositiveOutputRate(sdrData.worker);
                            edges.push({
                                id: `edge-${workerId}-${nodeId}`,
                                source: workerId,
                                target: nodeId,
                                sourceHandle: getNextOutputHandle(workerId),
                                targetHandle: getNextInputHandle(nodeId),
                                animated: isAnimated,
                                style: { stroke: getEdgeColor('iq', 0, isAnimated), strokeWidth: 2 },
                                type: 'smoothstep',
                            });
                        }
                    }
                });
            }

            // Column 1: FFT Processor
            columnX += HORIZONTAL_SPACING;
            if (sdrData.fft_processor) {
                const nodeId = `node-${nodeIdCounter++}`;
                nodeMap.set(`${sdrId}-fft`, nodeId);

                // Store FFT node for implicit browser connections later
                if (!nodeMap.has('fft-processors')) {
                    nodeMap.set('fft-processors', []);
                }
                nodeMap.get('fft-processors').push({ nodeId, fftProcessor: sdrData.fft_processor });

                nodes.push({
                    id: nodeId,
                    type: 'componentNode',
                    position: { x: columnX, y: sdrStartY },
                    data: {
                        label: `FFT Processor - ${truncateId(sdrId)}`,
                        component: sdrData.fft_processor,
                        type: 'fft',
                    },
                });

                // Edge: Worker -> FFT Processor (direct connection via iq_queue_fft)
                const workerId = nodeMap.get(`${sdrId}-worker`);
                if (workerId && sdrData.worker) {
                    const isAnimated = hasPositiveOutputRate(sdrData.worker);
                    edges.push({
                        id: `edge-${workerId}-${nodeId}`,
                        source: workerId,
                        target: nodeId,
                        sourceHandle: getNextOutputHandle(workerId),
                        targetHandle: getNextInputHandle(nodeId),
                        animated: isAnimated,
                        style: { stroke: getEdgeColor('iq', 0, isAnimated), strokeWidth: 2 },
                        type: 'smoothstep',
                    });
                }
            }

            // Column 2: Demodulators & Recorders (stacked vertically)
            columnX += HORIZONTAL_SPACING;
            let demodY = sdrStartY - 100;

            // Demodulators
            if (sdrData.demodulators) {
                Object.entries(sdrData.demodulators).forEach(([demodKey, demod]) => {
                    const nodeId = `node-${nodeIdCounter++}`;
                    nodeMap.set(`${sdrId}-demod-${demodKey}`, nodeId);

                    nodes.push({
                        id: nodeId,
                        type: 'componentNode',
                        position: { x: columnX, y: demodY },
                        data: {
                            label: `${demod.type} - ${truncateSessionVfoKey(demodKey)}`,
                            component: demod,
                            type: 'demodulator',
                        },
                    });

                    // Edge: IQ Broadcaster -> Demodulator
                    const iqBroadcasterId = nodeMap.get(`${sdrId}-iq-broadcaster`);
                    if (iqBroadcasterId) {
                        const iqBroadcaster = sdrData.broadcasters[`iq_${sdrId}`];
                        const isAnimated = hasPositiveOutputRate(iqBroadcaster);
                        const queueUtilization = demod.input_queue_size / Math.max(demod.input_queue_maxsize || 10, 1);

                        edges.push({
                            id: `edge-${iqBroadcasterId}-${nodeId}`,
                            source: iqBroadcasterId,
                            target: nodeId,
                            sourceHandle: getNextOutputHandle(iqBroadcasterId),
                            targetHandle: getNextInputHandle(nodeId),
                            animated: isAnimated,
                            style: { stroke: getEdgeColor('iq', queueUtilization, isAnimated), strokeWidth: 2 },
                            label: demod.input_queue_size ? `${demod.input_queue_size}` : undefined,
                            type: 'smoothstep',
                        });
                    }

                    // Check if demodulator connects to audio broadcaster (new per-VFO architecture)
                    const audioBroadcasterConnection = demod.connections?.find(c => c.target_type === 'audio_broadcaster');
                    if (audioBroadcasterConnection) {
                        // Will create edge after audio broadcasters are processed
                        if (!nodeMap.has('pending-demod-to-audio-broadcaster-edges')) {
                            nodeMap.set('pending-demod-to-audio-broadcaster-edges', []);
                        }
                        nodeMap.get('pending-demod-to-audio-broadcaster-edges').push({
                            demodulatorId: nodeId,
                            demodulator: demod,
                            targetBroadcasterId: audioBroadcasterConnection.target_id,
                        });
                    } else {
                        // Check if demodulator connects directly to audio streamer (old architecture)
                        const audioStreamerConnection = demod.connections?.find(c => c.target_type === 'audio_streamer');
                        if (audioStreamerConnection) {
                            // Store for later connection to WebAudioStreamer
                            if (!nodeMap.has('pending-demod-to-streamer-edges')) {
                                nodeMap.set('pending-demod-to-streamer-edges', []);
                            }
                            nodeMap.get('pending-demod-to-streamer-edges').push({
                                demodulatorId: nodeId,
                                demodulator: demod,
                                targetId: audioStreamerConnection.target_id,
                            });
                        }
                    }

                    demodY += VERTICAL_SPACING;
                });
            }

            // Audio Broadcasters (after demodulators, column 3)
            columnX += HORIZONTAL_SPACING;
            let audioBroadcasterY = sdrStartY - 100;

            if (sdrData.broadcasters) {
                Object.entries(sdrData.broadcasters).forEach(([broadcasterId, broadcaster]) => {
                    if (broadcaster.broadcaster_type === 'audio') {
                        const nodeId = `node-${nodeIdCounter++}`;

                        // Handle per-VFO broadcasters (new architecture) vs decoder broadcasters (old architecture)
                        let audioKey, label;
                        if (broadcaster.vfo_number !== undefined) {
                            // Per-VFO broadcaster from demodulator
                            audioKey = broadcasterId; // e.g., "audio_VbqH4y0D5ZZE8P27AAAB_vfo1"
                            label = `Audio Broadcaster - VFO ${broadcaster.vfo_number}`;
                        } else {
                            // Decoder broadcaster (old architecture)
                            audioKey = `${broadcaster.session_id}_${broadcaster.decoder_name}`;
                            label = `Audio Broadcaster - ${truncateId(broadcaster.session_id)}`;
                        }

                        nodeMap.set(`${sdrId}-audio-broadcaster-${audioKey}`, nodeId);

                        nodes.push({
                            id: nodeId,
                            type: 'componentNode',
                            position: { x: columnX, y: audioBroadcasterY },
                            data: {
                                label: label,
                                component: broadcaster,
                                type: 'broadcaster',
                            },
                        });

                        // Edge: Demodulator -> Audio Broadcaster
                        // Use connections data from broadcaster
                        const sourceConnection = broadcaster.connections?.find(c => c.source_type === 'demodulator');
                        if (sourceConnection) {
                            // The source_id is the full demodulator key (e.g., "-WClwJW9jcoFpBTGAAAV_vfo1")
                            const demodKey = `${sdrId}-demod-${sourceConnection.source_id}`;
                            const demodId = nodeMap.get(demodKey);
                            const sourceDemod = sdrData.demodulators[sourceConnection.source_id];

                            if (demodId) {
                                const isAnimated = hasPositiveOutputRate(sourceDemod);
                                edges.push({
                                    id: `edge-${demodId}-${nodeId}`,
                                    source: demodId,
                                    target: nodeId,
                                    sourceHandle: getNextOutputHandle(demodId),
                                    targetHandle: getNextInputHandle(nodeId),
                                    animated: isAnimated,
                                    style: { stroke: getEdgeColor('audio', 0, isAnimated), strokeWidth: 2 },
                                    type: 'smoothstep',
                                });
                            }
                        }

                        // Store audio broadcaster node ID for later connection to WebAudioStreamer
                        const audioBroadcasterNodeId = nodeId;

                        // We'll connect to WebAudioStreamer after all nodes are created
                        // Store reference for later (we'll process this after the main loop)
                        if (!nodeMap.has('pending-audio-broadcaster-edges')) {
                            nodeMap.set('pending-audio-broadcaster-edges', []);
                        }
                        nodeMap.get('pending-audio-broadcaster-edges').push({
                            audioBroadcasterId: audioBroadcasterNodeId,
                            broadcaster: broadcaster,
                        });

                        audioBroadcasterY += VERTICAL_SPACING;
                    }
                });
            }

            // Recorders (below demodulators)
            if (sdrData.recorders) {
                Object.entries(sdrData.recorders).forEach(([recKey, recorder]) => {
                    const nodeId = `node-${nodeIdCounter++}`;
                    nodeMap.set(`${sdrId}-recorder-${recKey}`, nodeId);

                    nodes.push({
                        id: nodeId,
                        type: 'componentNode',
                        position: { x: columnX, y: demodY },
                        data: {
                            label: `${recorder.type} - ${truncateSessionVfoKey(recKey)}`,
                            component: recorder,
                            type: 'recorder',
                        },
                    });

                    // Edge: IQ Broadcaster -> Recorder
                    const iqBroadcasterId = nodeMap.get(`${sdrId}-iq-broadcaster`);
                    if (iqBroadcasterId) {
                        const iqBroadcaster = sdrData.broadcasters[`iq_${sdrId}`];
                        const isAnimated = hasPositiveOutputRate(iqBroadcaster);
                        const queueUtilization = recorder.input_queue_size / Math.max(recorder.input_queue_maxsize || 10, 1);

                        edges.push({
                            id: `edge-${iqBroadcasterId}-${nodeId}`,
                            source: iqBroadcasterId,
                            target: nodeId,
                            sourceHandle: getNextOutputHandle(iqBroadcasterId),
                            targetHandle: getNextInputHandle(nodeId),
                            animated: isAnimated,
                            style: { stroke: getEdgeColor('iq', queueUtilization, isAnimated), strokeWidth: 2 },
                            label: recorder.input_queue_size ? `${recorder.input_queue_size}` : undefined,
                            type: 'smoothstep',
                        });
                    }

                    demodY += VERTICAL_SPACING;
                });
            }

            // Audio Recorders (below audio broadcasters, consume audio from per-VFO broadcasters)
            if (sdrData.audio_recorders) {
                Object.entries(sdrData.audio_recorders).forEach(([audioRecKey, audioRecorder]) => {
                    const nodeId = `node-${nodeIdCounter++}`;
                    nodeMap.set(`${sdrId}-audio-recorder-${audioRecKey}`, nodeId);

                    nodes.push({
                        id: nodeId,
                        type: 'componentNode',
                        position: { x: columnX, y: audioBroadcasterY },
                        data: {
                            label: `${audioRecorder.type} - ${truncateSessionVfoKey(audioRecKey)}`,
                            component: audioRecorder,
                            type: 'audio_recorder',
                        },
                    });

                    // Edge: Audio Broadcaster -> Audio Recorder
                    // Find the corresponding audio broadcaster for this session/VFO
                    const audioRecorderConnection = audioRecorder.connections?.[0];
                    if (audioRecorderConnection && audioRecorderConnection.source_type === 'audio_broadcaster') {
                        const audioBroadcasterKey = `${sdrId}-audio-broadcaster-${audioRecorderConnection.source_id}`;
                        const audioBroadcasterId = nodeMap.get(audioBroadcasterKey);

                        if (audioBroadcasterId) {
                            const audioBroadcaster = sdrData.broadcasters[audioRecorderConnection.source_id];
                            const isAnimated = hasPositiveOutputRate(audioBroadcaster);
                            const queueUtilization = audioRecorder.input_queue_size / Math.max(audioRecorder.input_queue_maxsize || 10, 1);

                            edges.push({
                                id: `edge-${audioBroadcasterId}-${nodeId}`,
                                source: audioBroadcasterId,
                                target: nodeId,
                                sourceHandle: getNextOutputHandle(audioBroadcasterId),
                                targetHandle: getNextInputHandle(nodeId),
                                animated: isAnimated,
                                style: { stroke: getEdgeColor('audio', queueUtilization, isAnimated), strokeWidth: 2 },
                                label: audioRecorder.input_queue_size ? `${audioRecorder.input_queue_size}` : undefined,
                                type: 'smoothstep',
                            });
                        }
                    }

                    audioBroadcasterY += VERTICAL_SPACING;
                });
            }

            // Column 4: Decoders (after audio broadcasters)
            if (sdrData.decoders) {
                columnX += HORIZONTAL_SPACING;
                let decoderY = sdrStartY - 100;

                Object.entries(sdrData.decoders).forEach(([decKey, decoder]) => {
                    const nodeId = `node-${nodeIdCounter++}`;

                    // Store decoder node by session for implicit browser connections later
                    if (decoder.session_id) {
                        if (!nodeMap.has('decoders-by-session')) {
                            nodeMap.set('decoders-by-session', {});
                        }
                        const decodersBySession = nodeMap.get('decoders-by-session');
                        if (!decodersBySession[decoder.session_id]) {
                            decodersBySession[decoder.session_id] = [];
                        }
                        decodersBySession[decoder.session_id].push({ nodeId, decoder });
                    }

                    nodes.push({
                        id: nodeId,
                        type: 'componentNode',
                        position: { x: columnX, y: decoderY },
                        data: {
                            label: `${decoder.type} - ${truncateSessionVfoKey(decKey)}`,
                            component: decoder,
                            type: 'decoder',
                        },
                    });

                    // Check decoder connections to determine source
                    const decoderConnection = decoder.connections?.[0]; // Decoders typically have one input connection

                    if (decoderConnection) {
                        if (decoderConnection.source_type === 'iq_broadcaster') {
                            // IQ-based decoder (BPSK, GMSK, LoRa) - connect from IQ broadcaster
                            const iqBroadcasterId = nodeMap.get(`${sdrId}-iq-broadcaster`);

                            if (iqBroadcasterId) {
                                const iqBroadcaster = sdrData.broadcasters[decoderConnection.source_id];
                                const isAnimated = hasPositiveOutputRate(iqBroadcaster);
                                const queueUtilization = decoder.input_queue_size / Math.max(decoder.input_queue_maxsize || 10, 1);

                                edges.push({
                                    id: `edge-${iqBroadcasterId}-${nodeId}`,
                                    source: iqBroadcasterId,
                                    target: nodeId,
                                    sourceHandle: getNextOutputHandle(iqBroadcasterId),
                                    targetHandle: getNextInputHandle(nodeId),
                                    animated: isAnimated,
                                    style: { stroke: getEdgeColor('iq', queueUtilization, isAnimated), strokeWidth: 2 },
                                    label: decoder.input_queue_size ? `${decoder.input_queue_size}` : undefined,
                                    type: 'smoothstep',
                                });
                            }
                        } else if (decoderConnection.source_type === 'audio_broadcaster') {
                            // Audio-based decoder (SSTV, Morse) - connect from audio broadcaster
                            const audioBroadcasterKey = decoderConnection.source_id
                                ? `${sdrId}-audio-broadcaster-${decoderConnection.source_id}`
                                : null;
                            let audioBroadcasterId = audioBroadcasterKey ? nodeMap.get(audioBroadcasterKey) : null;
                            let audioBroadcaster = decoderConnection.source_id
                                ? sdrData.broadcasters?.[decoderConnection.source_id]
                                : null;

                            if (!audioBroadcasterId) {
                                // Fallback for legacy keys: derive from decoder key (e.g., "session_vfo1")
                                const parts = decKey.split('_vfo');
                                if (parts.length === 2) {
                                    const sessionId = parts[0];
                                    const vfoNum = parts[1];
                                    audioBroadcasterId = nodeMap.get(`${sdrId}-audio-broadcaster-${sessionId}_${vfoNum}`);
                                    audioBroadcaster = sdrData.broadcasters?.[`audio_${sessionId}_${vfoNum}`];
                                }
                            }

                            if (audioBroadcasterId) {
                                const isAnimated = hasPositiveOutputRate(audioBroadcaster);
                                const queueUtilization = decoder.input_queue_size / Math.max(decoder.input_queue_maxsize || 10, 1);

                                edges.push({
                                    id: `edge-${audioBroadcasterId}-${nodeId}`,
                                    source: audioBroadcasterId,
                                    target: nodeId,
                                    sourceHandle: getNextOutputHandle(audioBroadcasterId),
                                    targetHandle: getNextInputHandle(nodeId),
                                    animated: isAnimated,
                                    style: { stroke: getEdgeColor('audio', queueUtilization, isAnimated), strokeWidth: 2 },
                                    label: decoder.input_queue_size ? `${decoder.input_queue_size}` : undefined,
                                    type: 'smoothstep',
                                });
                            }
                        }
                    }

                    decoderY += VERTICAL_SPACING;
                });
            }
        });
    }

    // Trackers (satellite trackers, etc.)
    if (metrics.trackers) {
        const trackerY = START_Y + (Object.keys(metrics.sdrs || {}).length * 1000);
        const trackerX = START_X; // Same position as SDR workers (leftmost)

        Object.entries(metrics.trackers).forEach(([trackerId, tracker], index) => {
            const nodeId = `node-${nodeIdCounter++}`;
            nodeMap.set(`tracker-${trackerId}`, nodeId);

            nodes.push({
                id: nodeId,
                type: 'componentNode',
                position: { x: trackerX, y: trackerY + (index * VERTICAL_SPACING) },
                data: {
                    label: `Satellite Tracker`,
                    component: tracker,
                    type: 'tracker',
                },
            });

            // Edges: Tracker -> Browsers (connections stored in tracker.connections)
            if (tracker.connections) {
                tracker.connections.forEach(conn => {
                    if (conn.target_type === 'browser') {
                        // Store for later connection to browser nodes
                        if (!nodeMap.has('pending-tracker-to-browser-edges')) {
                            nodeMap.set('pending-tracker-to-browser-edges', []);
                        }
                        nodeMap.get('pending-tracker-to-browser-edges').push({
                            trackerId: nodeId,
                            tracker: tracker,
                            targetId: conn.target_id,
                        });
                    }
                });
            }
        });
    }

    // Per-VFO Transcription Consumers (Google Gemini Live API transcription)
    // Process transcription consumers for each SDR (they're now per-VFO like demodulators/decoders)
    Object.entries(metrics.sdrs || {}).forEach(([sdrId, sdrData]) => {
        if (sdrData.transcription_consumers) {
            // Position transcription consumers after decoders (same column as audio streamers)
            const sdrStartY = START_Y + (Object.keys(metrics.sdrs || {}).indexOf(sdrId) * 1000);
            const transcriptionX = START_X + HORIZONTAL_SPACING * 3;
            let transcriptionY = sdrStartY + 200;

            Object.entries(sdrData.transcription_consumers).forEach(([transcriptionKey, transcription]) => {
                const nodeId = `node-${nodeIdCounter++}`;
                nodeMap.set(`transcription-${transcriptionKey}`, nodeId);

                nodes.push({
                    id: nodeId,
                    type: 'componentNode',
                    position: { x: transcriptionX, y: transcriptionY },
                    data: {
                        label: `Transcription - ${truncateSessionVfoKey(transcriptionKey)}`,
                        component: transcription,
                        type: 'transcription',
                    },
                });

                // Store for later connection to browser nodes (transcription outputs to browser)
                if (transcription.connections) {
                    transcription.connections.forEach(conn => {
                        if (conn.target_type === 'browser') {
                            if (!nodeMap.has('pending-transcription-to-browser-edges')) {
                                nodeMap.set('pending-transcription-to-browser-edges', []);
                            }
                            nodeMap.get('pending-transcription-to-browser-edges').push({
                                transcriptionId: nodeId,
                                transcription: transcription,
                                targetId: conn.target_id,
                            });
                        }
                    });
                }

                // Connect from corresponding audio broadcaster (if exists)
                // Transcription consumers subscribe to per-VFO audio broadcasters
                const vfoNumber = transcription.vfo_number;
                const sessionId = transcription.session_id;

                // Find the audio broadcaster for this session/VFO
                if (sdrData.broadcasters) {
                    Object.entries(sdrData.broadcasters).forEach(([bcastKey, broadcaster]) => {
                        if (broadcaster.session_id === sessionId && broadcaster.vfo_number === vfoNumber && broadcaster.broadcaster_type === 'audio') {
                            const broadcasterNodeId = nodeMap.get(`${sdrId}-audio-broadcaster-${bcastKey}`);
                            if (broadcasterNodeId) {
                                const isAnimated = hasPositiveOutputRate(broadcaster);
                                edges.push({
                                    id: `edge-${broadcasterNodeId}-${nodeId}`,
                                    source: broadcasterNodeId,
                                    target: nodeId,
                                    sourceHandle: getNextOutputHandle(broadcasterNodeId),
                                    targetHandle: getNextInputHandle(nodeId),
                                    animated: isAnimated,
                                    style: { stroke: getEdgeColor('audio', 0, isAnimated), strokeWidth: 1.5 },
                                    type: 'smoothstep',
                                });
                            }
                        }
                    });
                }

                transcriptionY += VERTICAL_SPACING;
            });
        }
    });

    // Collect all active sessions (browsers)
    const activeSessions = {};

    // Primary source: sessions data from _poll_sessions()
    if (metrics.sessions) {
        Object.values(metrics.sessions).forEach(session => {
            activeSessions[session.session_id] = {
                ip: session.client_ip || 'unknown',
                user_agent: session.user_agent || 'unknown',
                stats: { audio_chunks_in: 0, audio_samples_in: 0, messages_emitted: 0 },
                rates: { audio_chunks_in_per_sec: 0, audio_samples_in_per_sec: 0, messages_emitted_per_sec: 0 }
            };
        });
    }

    // Overlay audio streaming stats from audio_streamers
    if (metrics.audio_streamers) {
        Object.values(metrics.audio_streamers).forEach(streamer => {
            if (streamer.session_id && activeSessions[streamer.session_id]) {
                activeSessions[streamer.session_id].stats = streamer.stats;
                activeSessions[streamer.session_id].rates = streamer.rates;
            }
        });
    }

    // Audio Streamers (per-session instances from audio_streamers in metrics)
    let webAudioStreamerNodeId = null;
    if (metrics.audio_streamers && Object.keys(metrics.audio_streamers).length > 0) {
        const streamerY = START_Y + (Object.keys(metrics.sdrs || {}).length * 1000);
        const streamerX = START_X + HORIZONTAL_SPACING * 2;

        // Create nodes for each audio streamer
        Object.entries(metrics.audio_streamers).forEach(([streamerId, streamer], index) => {
            const nodeId = `node-${nodeIdCounter++}`;
            nodeMap.set(`audio-streamer-${streamerId}`, nodeId);

            // Keep reference to first one for backward compatibility
            if (index === 0) {
                webAudioStreamerNodeId = nodeId;
                nodeMap.set('audio-streamer-web_audio', nodeId); // Fallback for old architecture
            }

            // Create node for this audio streamer
            const yOffset = index * VERTICAL_SPACING;
            nodes.push({
                id: nodeId,
                type: 'componentNode',
                position: { x: streamerX, y: streamerY + yOffset },
                data: {
                    label: `WebAudioStreamer - ${truncateId(streamer.session_id)}`,
                    component: streamer,
                    type: 'streamer',
                },
            });
        });

        // Browser/Client nodes (one per session)
        const browserX = streamerX + HORIZONTAL_SPACING;
        let browserY = streamerY - 100;

        Object.entries(activeSessions).forEach(([sessionId, session]) => {
            const browserNodeId = `node-${nodeIdCounter++}`;
            nodeMap.set(`browser-${sessionId}`, browserNodeId);

            nodes.push({
                id: browserNodeId,
                type: 'componentNode',
                position: { x: browserX, y: browserY },
                data: {
                    label: `Browser - ${session.ip}`,
                    component: {
                        type: 'Browser',
                        session_id: sessionId,
                        client_ip: session.ip,
                        user_agent: session.user_agent,
                        is_alive: true,
                        stats: session.stats,
                        rates: session.rates,
                    },
                    type: 'browser',
                },
            });

            // Edge from corresponding WebAudioStreamer to Browser
            // Find the streamer for this session
            const correspondingStreamer = Object.entries(metrics.audio_streamers || {}).find(
                ([sid, s]) => s.session_id === sessionId
            );
            if (correspondingStreamer) {
                const [streamerId, streamer] = correspondingStreamer;
                const streamerNodeId = nodeMap.get(`audio-streamer-${streamerId}`);
                if (streamerNodeId) {
                    const isAnimated = hasPositiveOutputRate(streamer);
                    edges.push({
                        id: `edge-${streamerNodeId}-${browserNodeId}`,
                        source: streamerNodeId,
                        target: browserNodeId,
                        sourceHandle: getNextOutputHandle(streamerNodeId),
                        targetHandle: getNextInputHandle(browserNodeId),
                        animated: isAnimated,
                        style: { stroke: getEdgeColor('audio', 0, isAnimated), strokeWidth: 2 },
                        type: 'smoothstep',
                    });
                }
            }

            // Implicit edge: Tracker -> Browser (trackers broadcast to all connected browsers)
            const trackerEdges = nodeMap.get('pending-tracker-to-browser-edges') || [];
            trackerEdges.forEach(({ trackerId, tracker, targetId }) => {
                if (targetId === sessionId) {
                    const isAnimated = hasPositiveOutputRate(tracker, 'tracker');
                    edges.push({
                        id: `edge-implicit-tracker-${trackerId}-${browserNodeId}`,
                        source: trackerId,
                        target: browserNodeId,
                        sourceHandle: getNextOutputHandle(trackerId),
                        targetHandle: getNextInputHandle(browserNodeId),
                        animated: isAnimated,
                        style: { stroke: getEdgeColor('decoded', 0, isAnimated), strokeWidth: 1.5 },
                        type: 'smoothstep',
                    });
                }
            });

            // Implicit edge: FFT Processor -> Browser (all FFT processors send to all browsers)
            const fftProcessors = nodeMap.get('fft-processors') || [];
            fftProcessors.forEach(({ nodeId: fftNodeId, fftProcessor }) => {
                const isAnimated = hasPositiveOutputRate(fftProcessor);
                edges.push({
                    id: `edge-implicit-fft-${fftNodeId}-${browserNodeId}`,
                    source: fftNodeId,
                    target: browserNodeId,
                    sourceHandle: getNextOutputHandle(fftNodeId),
                    targetHandle: getNextInputHandle(browserNodeId),
                    animated: isAnimated,
                    style: { stroke: getEdgeColor('fft', 0, isAnimated), strokeWidth: 1.5 },
                    type: 'smoothstep',
                });
            });

            // Match backend routing: observation events reach every browser;
            // user decoder events reach only their owning session.
            const decodersBySession = nodeMap.get('decoders-by-session') || {};
            const sessionDecoders = Object.entries(decodersBySession)
                .filter(([decoderSessionId]) => decoderSessionId === sessionId || decoderSessionId.startsWith('internal:'))
                .flatMap(([, decoders]) => decoders);
            sessionDecoders.forEach(({ nodeId: decoderNodeId, decoder }) => {
                const isAnimated = hasPositiveOutputRate(decoder);
                edges.push({
                    id: `edge-implicit-decoder-${decoderNodeId}-${browserNodeId}`,
                    source: decoderNodeId,
                    target: browserNodeId,
                    sourceHandle: getNextOutputHandle(decoderNodeId),
                    targetHandle: getNextInputHandle(browserNodeId),
                    animated: isAnimated,
                    style: { stroke: getEdgeColor('decoded', 0, isAnimated), strokeWidth: 1.5 },
                    type: 'smoothstep',
                });
            });

            // Implicit edge: Transcription Consumer -> Browser (transcriptions broadcast to all browsers)
            const transcriptionEdges = nodeMap.get('pending-transcription-to-browser-edges') || [];
            transcriptionEdges.forEach(({ transcriptionId, transcription, targetId }) => {
                if (targetId === sessionId) {
                    const isAnimated = hasPositiveOutputRate(transcription);
                    edges.push({
                        id: `edge-implicit-transcription-${transcriptionId}-${browserNodeId}`,
                        source: transcriptionId,
                        target: browserNodeId,
                        sourceHandle: getNextOutputHandle(transcriptionId),
                        targetHandle: getNextInputHandle(browserNodeId),
                        animated: isAnimated,
                        style: { stroke: getEdgeColor('decoded', 0, isAnimated), strokeWidth: 1.5 },
                        type: 'smoothstep',
                    });
                }
            });

            browserY += VERTICAL_SPACING;
        });
    }

    // Process pending audio broadcaster -> WebAudioStreamer edges
    const pendingEdges = nodeMap.get('pending-audio-broadcaster-edges');
    if (pendingEdges && pendingEdges.length > 0) {
        pendingEdges.forEach(({ audioBroadcasterId, broadcaster }) => {
            // Look for audio_streamer target in connections (new architecture)
            const audioStreamerConnection = broadcaster.connections?.find(c => c.target_type === 'audio_streamer');
            if (audioStreamerConnection) {
                // Connect to the session-specific WebAudioStreamer
                // The target_id is like "web_audio_VbqH4y0D5ZZE8P27AAAB"
                const streamerId = nodeMap.get(`audio-streamer-${audioStreamerConnection.target_id}`);
                if (streamerId) {
                    const isAnimated = hasPositiveOutputRate(broadcaster);
                    edges.push({
                        id: `edge-${audioBroadcasterId}-${streamerId}`,
                        source: audioBroadcasterId,
                        target: streamerId,
                        sourceHandle: getNextOutputHandle(audioBroadcasterId),
                        targetHandle: getNextInputHandle(streamerId),
                        animated: isAnimated,
                        style: { stroke: getEdgeColor('audio', 0, isAnimated), strokeWidth: 2 },
                        type: 'smoothstep',
                    });
                }
            } else {
                // Fallback to old architecture: Look for UI target in connections
                const uiConnection = broadcaster.connections?.find(c => c.target_type === 'ui');
                if (uiConnection) {
                    // Connect to the single WebAudioStreamer
                    const webAudioStreamerId = nodeMap.get('audio-streamer-web_audio');
                    if (webAudioStreamerId) {
                        const isAnimated = hasPositiveOutputRate(broadcaster);
                        edges.push({
                            id: `edge-${audioBroadcasterId}-${webAudioStreamerId}`,
                            source: audioBroadcasterId,
                            target: webAudioStreamerId,
                            sourceHandle: getNextOutputHandle(audioBroadcasterId),
                            targetHandle: getNextInputHandle(webAudioStreamerId),
                            animated: isAnimated,
                            style: { stroke: getEdgeColor('audio', 0, isAnimated), strokeWidth: 2 },
                            type: 'smoothstep',
                        });
                    }
                }
            }

        });
    }

    // Process pending demodulator -> WebAudioStreamer edges
    const pendingDemodEdges = nodeMap.get('pending-demod-to-streamer-edges');
    if (pendingDemodEdges && pendingDemodEdges.length > 0) {
        pendingDemodEdges.forEach(({ demodulatorId, demodulator, targetId }) => {
            // Connect to the single WebAudioStreamer
            const streamerId = nodeMap.get('audio-streamer-web_audio');
            if (streamerId) {
                const isAnimated = hasPositiveOutputRate(demodulator);
                edges.push({
                    id: `edge-${demodulatorId}-${streamerId}`,
                    source: demodulatorId,
                    target: streamerId,
                    sourceHandle: getNextOutputHandle(demodulatorId),
                    targetHandle: getNextInputHandle(streamerId),
                    animated: isAnimated,
                    style: { stroke: getEdgeColor('audio', 0, isAnimated), strokeWidth: 2 },
                    type: 'smoothstep',
                });
            }
        });
    }

    // Count connections for each node
    // Track implicit broadcast sources to only count them once
    const implicitBroadcastSources = new Set();

    edges.forEach(edge => {
        const sourceId = edge.source;
        const targetId = edge.target;

        initNodeConnections(sourceId);
        initNodeConnections(targetId);

        // Check if this is an implicit broadcast edge
        const isImplicitBroadcast = edge.id.includes('edge-implicit-fft-') ||
                                    edge.id.includes('edge-implicit-decoder-') ||
                                    edge.id.includes('edge-implicit-tracker-') ||
                                    edge.id.includes('edge-implicit-transcription-');

        if (isImplicitBroadcast) {
            // Only count implicit broadcast once per source (they all share one handle)
            if (!implicitBroadcastSources.has(sourceId)) {
                connectionCounts.get(sourceId).outputs++;
                implicitBroadcastSources.add(sourceId);
            }
        } else {
            // Normal edges count individually
            connectionCounts.get(sourceId).outputs++;
        }

        // Inputs always count individually (each browser gets separate input)
        connectionCounts.get(targetId).inputs++;
    });

    // Update nodes with connection counts
    nodes.forEach(node => {
        const counts = connectionCounts.get(node.id) || { inputs: 1, outputs: 1 };
        node.data.inputCount = Math.max(counts.inputs, 1);
        node.data.outputCount = Math.max(counts.outputs, 1);
    });

    // Reset handle counters and assign handle IDs to edges
    nodeHandleCounters.clear();
    // Re-initialize all node counters
    nodes.forEach(node => {
        nodeHandleCounters.set(node.id, { inputIndex: 0, outputIndex: 0 });
    });

    // Track handles for implicit broadcast connections (all use same source handle)
    const implicitHandles = new Map(); // nodeId -> handleId for FFT and decoder broadcasts

    edges.forEach(edge => {
        // Check if this is an implicit broadcast edge (FFT→Browser, Decoder→Browser, Tracker→Browser, or Transcription→Browser)
        const isImplicitBroadcast = edge.id.includes('edge-implicit-fft-') ||
                                    edge.id.includes('edge-implicit-decoder-') ||
                                    edge.id.includes('edge-implicit-tracker-') ||
                                    edge.id.includes('edge-implicit-transcription-');

        if (isImplicitBroadcast) {
            // All implicit edges from same source share the same output handle
            if (!implicitHandles.has(edge.source)) {
                implicitHandles.set(edge.source, getNextOutputHandle(edge.source));
            }
            edge.sourceHandle = implicitHandles.get(edge.source);
            edge.targetHandle = getNextInputHandle(edge.target);
        } else {
            // Normal edges get unique handles
            edge.sourceHandle = getNextOutputHandle(edge.source);
            edge.targetHandle = getNextInputHandle(edge.target);
        }
    });

    // Apply Dagre layout with rank constraints
    const layoutedNodes = applyDagreLayout(nodes, edges);

    return { nodes: layoutedNodes, edges };
};
