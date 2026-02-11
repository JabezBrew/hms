import { useCallback, useEffect, useState } from 'react';

export function useInView({
  rootMargin = '200px',
  threshold = 0.1,
  once = true,
} = {}) {
  const [node, setNode] = useState(null);
  const [inView, setInView] = useState(false);

  const ref = useCallback((element) => {
    setNode(element);
  }, []);

  useEffect(() => {
    if (!node) return;
    if (inView && once) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [node, inView, once, rootMargin, threshold]);

  return { ref, inView };
}
