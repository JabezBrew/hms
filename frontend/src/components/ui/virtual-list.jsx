/* oxlint-disable react-doctor/no-initialize-state -- Virtualized viewport size is DOM-measured after mount via ResizeObserver; render-time initialization cannot know container height. */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function VirtualList({
  items,
  renderItem,
  itemHeight = 96,
  overscan = 6,
  endOffset = 3,
  onEndReached,
  className,
}) {
  const containerRef = useRef(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const element = containerRef.current;
    const updateHeight = () => setViewportHeight(element.clientHeight || 0);

    if (typeof ResizeObserver === 'undefined') {
      updateHeight();
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setViewportHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(element);
    updateHeight();

    return () => resizeObserver.disconnect();
  }, []);

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
  );
  const offsetY = startIndex * itemHeight;
  const visibleItems = items.slice(startIndex, endIndex);

  const handleScroll = (event) => {
    const { scrollTop: nextScrollTop, clientHeight } = event.currentTarget;
    setScrollTop(nextScrollTop);

    if (
      onEndReached &&
      totalHeight > 0 &&
      nextScrollTop + clientHeight >= totalHeight - itemHeight * endOffset
    ) {
      onEndReached();
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-y-auto', className)}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight }} />
      <div
        className="absolute left-0 right-0 top-0"
        style={{ transform: `translateY(${offsetY}px)` }}
      >
        {visibleItems.map((item, index) => renderItem(item, startIndex + index))}
      </div>
    </div>
  );
}
