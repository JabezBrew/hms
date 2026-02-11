import { useEffect, useState } from 'react';
import { useInView } from '@/hooks/useInView';

export function DeferredMount({
  children,
  placeholder = null,
  rootMargin = '200px',
  threshold = 0.1,
  className,
}) {
  const { ref, inView } = useInView({ rootMargin, threshold, once: true });
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    if (inView) {
      setHasMounted(true);
    }
  }, [inView]);

  return (
    <div ref={ref} className={className}>
      {hasMounted ? children : placeholder}
    </div>
  );
}

export default DeferredMount;
