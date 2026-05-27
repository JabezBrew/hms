import { useInView } from '@/hooks/useInView';

export function DeferredMount({
  children,
  placeholder = null,
  rootMargin = '200px',
  threshold = 0.1,
  className,
}) {
  const { ref, inView } = useInView({ rootMargin, threshold, once: true });

  return (
    <div ref={ref} className={className}>
      {inView ? children : placeholder}
    </div>
  );
}

export default DeferredMount;
