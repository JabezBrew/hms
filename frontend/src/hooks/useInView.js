import { useCallback, useRef, useState } from 'react';

export function useInView({
  rootMargin = '200px',
  threshold = 0.1,
  once = true,
} = {}) {
  const [inView, setInView] = useState(false);
  const observerRef = useRef(null);
  const inViewRef = useRef(false);

  const ref = useCallback((node) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node || (inViewRef.current && once)) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          inViewRef.current = true;
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          inViewRef.current = false;
          setInView(false);
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(node);
    observerRef.current = observer;
  }, [once, rootMargin, threshold]);

  return { ref, inView };
}
