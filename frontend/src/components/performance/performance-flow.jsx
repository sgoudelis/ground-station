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

import React, { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    useReactFlow,
    Panel,
    ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Box, Button, Typography } from '@mui/material';
import { ComponentNode } from './flow-node.jsx';
import { createFlowFromMetrics, applyDagreLayout, preserveNodePositions } from './flow-layout.js';
import { useTranslation } from 'react-i18next';

const nodeTypes = {
    componentNode: ComponentNode,
};

const FlowContent = ({ metrics, onAutoArrangeCallback }) => {
    const { t } = useTranslation('common');
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [graphUnlocked, setGraphUnlocked] = useState(false);
    const fitViewCalledRef = useRef(false);
    const { fitView } = useReactFlow();

    // Convert metrics to nodes and edges
    const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
        if (!metrics) return { nodes: [], edges: [] };
        return createFlowFromMetrics(metrics);
    }, [metrics]);

    // Locked graphs follow the generated layout. When the user unlocks the graph,
    // metric updates must retain any positions they have dragged nodes to.
    useEffect(() => {
        setNodes((currentNodes) => (
            graphUnlocked
                ? preserveNodePositions(flowNodes, currentNodes)
                : flowNodes
        ));
        setEdges(flowEdges);
    }, [flowNodes, flowEdges, graphUnlocked, setNodes, setEdges]);

    // Fit view after nodes are rendered (only on first load)
    useEffect(() => {
        if (nodes.length > 0 && !fitViewCalledRef.current) {
            fitViewCalledRef.current = true;
            // Wait for nodes to be fully rendered with their dimensions
            const timeoutId = setTimeout(() => {
                fitView({ padding: 0.2, duration: 0 });
            }, 200);
            return () => clearTimeout(timeoutId);
        }
    }, [nodes.length, fitView]);

    // Auto-arrange handler
    const onAutoArrange = useCallback(() => {
        const layoutedNodes = applyDagreLayout(nodes, edges);
        setNodes(layoutedNodes);

        // Fit view after layout instantly
        window.requestAnimationFrame(() => {
            fitView({ padding: 0.2, duration: 0 });
        });
    }, [nodes, edges, setNodes, fitView]);

    // Expose the auto-arrange handler to parent
    useEffect(() => {
        if (onAutoArrangeCallback) {
            onAutoArrangeCallback(onAutoArrange);
        }
    }, [onAutoArrange, onAutoArrangeCallback]);

    return (
        <Box
            sx={{
                width: '100%',
                height: '100%',
                backgroundColor: (theme) => theme.palette.background?.default || theme.palette.background.default,
                '& .react-flow__controls': {
                    backgroundColor: (theme) => theme.palette.background?.paper || theme.palette.background.paper,
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 1,
                    top: '20px !important',
                    right: '20px !important',
                    bottom: 'auto !important',
                    left: 'auto !important',
                    zIndex: 10,
                    pointerEvents: 'auto',
                },
                '& .react-flow__controls-button': {
                    backgroundColor: (theme) => theme.palette.background?.paper || theme.palette.background.paper,
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    color: (theme) => theme.palette.text.primary,
                    '&:hover': {
                        backgroundColor: (theme) => theme.palette.action?.hover || 'rgba(255, 255, 255, 0.08)',
                    },
                    '&:last-child': {
                        borderBottom: 'none',
                    },
                },
                '& .react-flow__controls-button svg': {
                    fill: (theme) => theme.palette.text.primary,
                },
                '& .react-flow__attribution': {
                    backgroundColor: (theme) => theme.palette.background?.paper || theme.palette.background.paper,
                    color: (theme) => theme.palette.text.secondary,
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 1,
                    padding: '4px 8px',
                    fontSize: '10px',
                },
                '& .react-flow__attribution a': {
                    color: (theme) => theme.palette.primary.main,
                    textDecoration: 'none',
                    '&:hover': {
                        textDecoration: 'underline',
                    },
                },
            }}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                attributionPosition="bottom-left"
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
            >
                <Background
                    color="#888"
                    gap={16}
                    variant="dots"
                />
                <Controls onInteractiveChange={setGraphUnlocked} />
                <Panel position="top-left" style={{ zIndex: 1 }}>
                    <Box
                        sx={{
                            backgroundColor: 'rgba(128, 128, 128, 0.15)',
                            padding: 1,
                            borderRadius: 0.75,
                            minWidth: 150,
                            pointerEvents: 'none',
                            opacity: 0.5,
                        }}
                    >
                        <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#fff', display: 'block', mb: 0.5, fontSize: '0.65rem' }}>
                            {t('performance_flow.data_types', { defaultValue: 'Data Types' })}
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3, mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box sx={{ width: 18, height: 1.5, backgroundColor: '#2196f3' }} />
                                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                    {t('performance_flow.iq_samples', { defaultValue: 'IQ Samples' })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box sx={{ width: 18, height: 1.5, backgroundColor: '#4caf50' }} />
                                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                    {t('performance_flow.audio', { defaultValue: 'Audio' })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box sx={{ width: 18, height: 1.5, backgroundColor: '#9c27b0' }} />
                                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                    {t('performance_flow.fft_waterfall', { defaultValue: 'FFT/Waterfall' })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box sx={{ width: 18, height: 1.5, backgroundColor: '#ff9800' }} />
                                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                    {t('performance_flow.decoded_data', { defaultValue: 'Decoded Data' })}
                                </Typography>
                            </Box>
                        </Box>
                        <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#fff', display: 'block', mb: 0.5, fontSize: '0.65rem' }}>
                            {t('performance_flow.line_styles', { defaultValue: 'Line Styles' })}
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3, mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box sx={{ width: 18, height: 0, borderTop: '1.5px dotted #fff' }} />
                                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                    {t('performance_flow.data_flowing', { defaultValue: 'Data Flowing' })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box sx={{ width: 18, height: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.3)' }} />
                                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                    {t('performance_flow.no_flow_idle', { defaultValue: 'No Flow / Idle' })}
                                </Typography>
                            </Box>
                        </Box>
                        <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#fff', display: 'block', mb: 0.5, fontSize: '0.65rem' }}>
                            {t('performance_flow.queue_health', { defaultValue: 'Queue Health' })}
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box sx={{ width: 18, height: 1.5, backgroundColor: '#4caf50' }} />
                                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                    {t('performance_flow.healthy_lt_50', { defaultValue: 'Healthy (&lt;50%)' })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box sx={{ width: 18, height: 1.5, backgroundColor: '#ff9800' }} />
                                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                    {t('performance_flow.warning_50_80', { defaultValue: 'Warning (50-80%)' })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Box sx={{ width: 18, height: 1.5, backgroundColor: '#f44336' }} />
                                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                    {t('performance_flow.critical_gt_80', { defaultValue: 'Critical (&gt;80%)' })}
                                </Typography>
                            </Box>
                        </Box>
                        <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#fff', display: 'block', mt: 1, mb: 0.5, fontSize: '0.65rem' }}>
                            {t('performance_flow.real_time_factor', { defaultValue: 'Real-time factor' })}
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                            <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                {t('performance_flow.green_p95_below_0_50', { defaultValue: 'Green: P95 below 0.50' })}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                {t('performance_flow.amber_p95_from_0_50_to_0_99', { defaultValue: 'Amber: P95 from 0.50 to 0.99' })}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                {t('performance_flow.red_p95_at_or_above_1_00', { defaultValue: 'Red: P95 at or above 1.00' })}
                            </Typography>
                        </Box>
                        <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#fff', display: 'block', mt: 1, mb: 0.5, fontSize: '0.65rem' }}>
                            {t('performance_flow.queue_end_to_end_age', { defaultValue: 'Queue / end-to-end age' })}
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                            <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                {t('performance_flow.green_below_100ms', { defaultValue: 'Green: below 100ms' })}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                {t('performance_flow.amber_100ms_to_499ms', { defaultValue: 'Amber: 100ms to 499ms' })}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.6rem' }}>
                                {t('performance_flow.red_500ms_or_higher', { defaultValue: 'Red: 500ms or higher' })}
                            </Typography>
                        </Box>
                    </Box>
                </Panel>
            </ReactFlow>
        </Box>
    );
};

const PerformanceFlow = ({ metrics, onAutoArrangeCallback }) => {
    return (
        <ReactFlowProvider>
            <FlowContent metrics={metrics} onAutoArrangeCallback={onAutoArrangeCallback} />
        </ReactFlowProvider>
    );
};

export default PerformanceFlow;
