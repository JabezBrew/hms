import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

export function VirtualizedGrid({
  items = [],
  renderItem,
  minItemWidth = 280,
  rowHeight = 320,
  overscan = 6,
  threshold = 40,
  gap = 16,
  useWindow = true,
  height = 600,
  className,
  containerClassName,
  getItemKey,
}) {
  const hasItems = items && items.length > 0;
  const shouldVirtualize = hasItems && items.length >= threshold;
  const containerRef = useRef(null);
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateColumns = () => {
      const width = containerRef.current?.offsetWidth || 0;
      const nextColumns = Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)));
      setColumns(nextColumns);
    };

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [minItemWidth, gap]);

  const rowCount = useMemo(
    () => Math.ceil(items.length / Math.max(columns, 1)),
    [items.length, columns]
  );

  const windowVirtualizer = useWindowVirtualizer({
    count: shouldVirtualize ? rowCount : 0,
    estimateSize: () => rowHeight + gap,
    overscan,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });
  const elementVirtualizer = useVirtualizer({
    count: shouldVirtualize ? rowCount : 0,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight + gap,
    overscan,
  });
  const virtualizer = useWindow ? windowVirtualizer : elementVirtualizer;
  const virtualRows = virtualizer.getVirtualItems();

  if (!hasItems) {
    return null;
  }

  if (!shouldVirtualize) {
    return (
      <div
        ref={containerRef}
        className={cn(className)}
        style={{
          display: 'grid',
          gap,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}
      >
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
      ref={containerRef}
      className={cn(containerClassName)}
      style={useWindow ? undefined : { height, overflow: 'auto' }}
    >
      <div
        className={cn(className)}
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualRows.map((virtualRow) => {
          const start = virtualRow.index * columns;
          const rowItems = items.slice(start, start + columns);

          return (
            <div
              key={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gap,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {rowItems.map((item, index) => {
                  const itemIndex = start + index;
                  const key = getItemKey ? getItemKey(item, itemIndex) : itemIndex;
                  return (
                    <div key={key}>
                      {renderItem(item, itemIndex)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedGrid;
