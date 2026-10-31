import { useEffect, useState } from 'react';

/**
 * Keep a closable component mounted for `delayMs` after `open` turns false, so
 * its exit transition can finish, then report that it may unmount.
 *
 * Dialogs that stay mounted while closed still run their hooks on every parent
 * render; on busy pages that is pure waste, so wrap them with this.
 *
 * @param {boolean} open
 * @param {number} delayMs
 * @returns {boolean} whether the component should currently be rendered
 */
export const useDelayedUnmount = (open, delayMs = 300) => {
    const [mounted, setMounted] = useState(Boolean(open));

    useEffect(() => {
        if (open) {
            setMounted(true);
            return undefined;
        }
        const timer = window.setTimeout(() => setMounted(false), delayMs);
        return () => window.clearTimeout(timer);
    }, [open, delayMs]);

    return Boolean(open) || mounted;
};
