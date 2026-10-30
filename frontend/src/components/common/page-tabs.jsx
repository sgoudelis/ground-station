import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

const PageTabsOffsetContext = createContext('var(--AppBar-height, 52px)');

export default function PageTabsLayout({ tabs, children, sx }) {
    const top = useContext(PageTabsOffsetContext);
    const tabsRef = useRef(null);
    const [tabsHeight, setTabsHeight] = useState(0);
    const hasTabs = Boolean(tabs);

    useLayoutEffect(() => {
        const element = tabsRef.current;
        if (!element) return;

        // Measure complete rows, including borders and wrapped labels, so nested tabs never overlap.
        const updateHeight = () => setTabsHeight(element.getBoundingClientRect().height);
        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(element);
        return () => observer.disconnect();
    }, [hasTabs]);

    return (
        <Box sx={[{ flexGrow: 1, bgcolor: 'background.paper' }, ...(Array.isArray(sx) ? sx : [sx])]}>
            {hasTabs && (
                <Box
                    ref={tabsRef}
                    data-page-tabs
                    sx={{
                        position: 'sticky',
                        top,
                        zIndex: (theme) => theme.zIndex.appBar - 1,
                        bgcolor: 'background.paper',
                        boxShadow: (theme) => theme.palette.mode === 'dark'
                            ? '0 2px 4px rgba(0, 0, 0, 0.45)'
                            : '0 1px 3px rgba(0, 0, 0, 0.08)',
                    }}
                >
                    {tabs}
                </Box>
            )}
            <PageTabsOffsetContext.Provider value={hasTabs ? `calc(${top} + ${tabsHeight}px)` : top}>
                {children}
            </PageTabsOffsetContext.Provider>
        </Box>
    );
}
