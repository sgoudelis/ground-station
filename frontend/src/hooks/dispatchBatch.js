/**
 * Coalesce bursts of socket handlers into a single task.
 *
 * Tracker processes tick in lock-step, so their messages arrive as a burst of
 * separate WebSocket tasks. Every Redux dispatch from a separate task costs a
 * full synchronous react-redux render; queuing the handlers and running the
 * whole burst in one timer callback lets React batch them into one render.
 */
export const createDispatchBatcher = ({
    windowMs = 100,
    schedule = (fn, ms) => window.setTimeout(fn, ms),
    cancel = (id) => window.clearTimeout(id),
    onError = (error) => console.error('Batched socket handler failed:', error),
} = {}) => {
    let queue = [];
    let timer = null;

    const flush = () => {
        timer = null;
        const batch = queue;
        queue = [];
        // Order is preserved so sequenced reducers see messages as sent.
        for (const handler of batch) {
            try {
                handler();
            } catch (error) {
                onError(error);
            }
        }
    };

    const enqueue = (handler) => {
        queue.push(handler);
        if (timer === null) {
            timer = schedule(flush, windowMs);
        }
    };

    const dispose = () => {
        if (timer !== null) cancel(timer);
        timer = null;
        queue = [];
    };

    return { enqueue, flush, dispose };
};
