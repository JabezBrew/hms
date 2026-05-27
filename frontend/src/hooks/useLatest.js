import { useRef, useEffect } from 'react';

/**
 * useLatest - Returns a ref that always contains the latest value
 *
 * Useful for capturing the latest value of a callback or prop in a ref,
 * so you can use it in effects without adding the value to dependencies.
 * This prevents unnecessary effect re-runs when callbacks change reference.
 *
 * @param {T} value - The value to keep current
 * @returns {React.MutableRefObject<T>} - Ref containing the latest value
 *
 * @example
 * function Component({ onAlert }) {
 *   const onAlertRef = useLatest(onAlert);
 *
 *   useEffect(() => {
 *     // Use onAlertRef.current instead of onAlert
 *     // This effect won't re-run when onAlert changes
 *     ws.on('alert', (data) => onAlertRef.current?.(data));
 *   }, []); // No need to add onAlert to deps
 * }
 */
export function useLatest(value) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

