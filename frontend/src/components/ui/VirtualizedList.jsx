import { useRef } from 'react';
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

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
  const windowVirtualizer = useWindowVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    estimateSize: () => estimateSize + gap,
    overscan,
    scrollMargin: parentRef.current?.offsetTop ?? 0,
  });
  const elementVirtualizer = useVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize + gap,
    overscan,
  });
  const virtualizer = useWindow ? windowVirtualizer : elementVirtualizer;

  const virtualItems = virtualizer.getVirtualItems();

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
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
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
