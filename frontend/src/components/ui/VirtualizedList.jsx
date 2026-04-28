import { useCallback, useRef } from 'react';
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

function getScrollMargin(element) {
  if (!element) return 0;

  const rect = element.getBoundingClientRect?.();
  if (!rect) {
    return element.offsetTop ?? 0;
  }

  if (typeof window === 'undefined') {
    return rect.top;
  }

  return rect.top + window.scrollY;
}

export function VirtualizedList({
  items = [],
  renderItem,
  estimateSize = 80,
  overscan = 6,
  threshold = 40,
  gap = 16,
  useWindow = true,
  height = 500,
  className,
  containerClassName,
  getItemKey,
}) {
  const hasItems = items && items.length > 0;
  const shouldVirtualize = hasItems && items.length >= threshold;
  const parentRef = useRef(null);
  const observeElementRect = useCallback((instance, cb) => {
    const element = instance.scrollElement;
    if (!element) return;

    const targetWindow = instance.targetWindow;
    if (!targetWindow) return;

    const resolveRect = () => {
      const rect = element.getBoundingClientRect?.() ?? { width: 0, height: 0 };
      const width = element.offsetWidth || element.clientWidth || rect.width || 0;
      let resolvedHeight = element.offsetHeight || element.clientHeight || rect.height || 0;

      if (!resolvedHeight && height) {
        resolvedHeight = height;
      }

      cb({ width: Math.round(width), height: Math.round(resolvedHeight) });
    };

    resolveRect();

    if (!targetWindow.ResizeObserver) {
      return () => {};
    }

    const observer = new targetWindow.ResizeObserver(resolveRect);
    observer.observe(element, { box: 'border-box' });

    return () => observer.unobserve(element);
  }, [height]);
  const scrollMargin = useWindow ? getScrollMargin(parentRef.current) : 0;
  const windowVirtualizer = useWindowVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    estimateSize: () => estimateSize + gap,
    overscan,
    scrollMargin,
  });
  const elementVirtualizer = useVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize + gap,
    overscan,
    initialRect: useWindow ? undefined : { height, width: 0 },
    ...(useWindow ? {} : { observeElementRect }),
  });
  const virtualizer = useWindow ? windowVirtualizer : elementVirtualizer;

  const virtualItems = virtualizer.getVirtualItems();
  const virtualScrollMargin = useWindow ? (virtualizer.options?.scrollMargin ?? scrollMargin) : 0;

  if (!hasItems) {
    return null;
  }

  if (!shouldVirtualize) {
    return (
      <div className={cn(className)}>
        {items.map((item, index) => (
          <div key={getItemKey ? getItemKey(item, index) : index}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={cn(containerClassName)}
      style={useWindow ? undefined : { height, overflow: 'auto' }}
    >
      <div
        className={cn(className)}
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          const key = getItemKey ? getItemKey(item, virtualRow.index) : virtualRow.index;

          return (
            <div
              key={key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start - virtualScrollMargin}px)`,
                paddingBottom: gap,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedList;
