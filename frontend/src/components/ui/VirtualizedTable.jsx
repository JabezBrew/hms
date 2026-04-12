import { useMemo, useRef } from 'react';
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

export function VirtualizedTable({
  rows = [],
  columns = [],
  rowKey,
  rowHeight = 48,
  overscan = 6,
  threshold = 40,
  useWindow = true,
  height = 500,
  className,
  headerClassName,
  rowClassName,
  getRowClassName,
  onRowClick,
}) {
  const hasRows = rows && rows.length > 0;
  const gridTemplateColumns = useMemo(
    () =>
      columns
        .map((column) => column.width || 'minmax(0, 1fr)')
        .join(' '),
    [columns]
  );

  const shouldVirtualize = hasRows && rows.length >= threshold;
  const isRowClickable = typeof onRowClick === 'function';

  const resolveRowClassName = (row, index) => cn(
    rowClassName,
    getRowClassName ? getRowClassName(row, index) : null,
    isRowClickable ? 'cursor-pointer' : null
  );

  const handleRowKeyDown = (event, row, index) => {
    if (!isRowClickable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(row, index);
    }
  };

  const parentRef = useRef(null);
  const scrollMargin = useWindow ? getScrollMargin(parentRef.current) : 0;
  const windowVirtualizer = useWindowVirtualizer({
    count: shouldVirtualize ? rows.length : 0,
    estimateSize: () => rowHeight,
    overscan,
    scrollMargin,
  });
  const elementVirtualizer = useVirtualizer({
    count: shouldVirtualize ? rows.length : 0,
    estimateSize: () => rowHeight,
    overscan,
    getScrollElement: () => parentRef.current,
  });
  const virtualizer = useWindow ? windowVirtualizer : elementVirtualizer;
  const virtualRows = virtualizer.getVirtualItems();
  const virtualScrollMargin = useWindow ? (virtualizer.options?.scrollMargin ?? scrollMargin) : 0;

  if (!hasRows) {
    return null;
  }

  if (!shouldVirtualize) {
    return (
      <div className={cn("rounded-lg border border-border/60", className)} role="table">
        <div
          role="row"
          className={cn("grid bg-muted/50 text-xs font-mono", headerClassName)}
          style={{ gridTemplateColumns }}
        >
          {columns.map((column) => (
            <div
              key={column.key}
              role="columnheader"
              className={cn("px-3 py-2 text-muted-foreground", column.headerClassName)}
            >
              {column.header}
            </div>
          ))}
        </div>
        <div role="rowgroup">
          {rows.map((row, index) => (
            <div
              key={rowKey ? rowKey(row, index) : index}
              role="row"
              className={cn("grid border-t border-border/50", resolveRowClassName(row, index))}
              style={{ gridTemplateColumns }}
              onClick={isRowClickable ? () => onRowClick(row, index) : undefined}
              onKeyDown={(event) => handleRowKeyDown(event, row, index)}
              tabIndex={isRowClickable ? 0 : undefined}
            >
              {columns.map((column) => (
                <div
                  key={column.key}
                  role="cell"
                  className={cn("px-3 py-2 text-sm", column.cellClassName)}
                >
                  {column.render ? column.render(row, index) : row[column.key]}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={cn("rounded-lg border border-border/60", className)}
      style={useWindow ? undefined : { height, overflow: 'auto' }}
      role="table"
    >
      <div
        role="row"
        className={cn("grid bg-muted/50 text-xs font-mono sticky top-0 z-10", headerClassName)}
        style={{ gridTemplateColumns }}
      >
        {columns.map((column) => (
          <div
            key={column.key}
            role="columnheader"
            className={cn("px-3 py-2 text-muted-foreground", column.headerClassName)}
          >
            {column.header}
          </div>
        ))}
      </div>
      <div
        role="rowgroup"
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          const key = rowKey ? rowKey(row, virtualRow.index) : virtualRow.index;

          return (
            <div
              key={key}
              ref={virtualizer.measureElement}
              role="row"
              className={cn("grid border-t border-border/50", resolveRowClassName(row, virtualRow.index))}
              style={{
                gridTemplateColumns,
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start - virtualScrollMargin}px)`,
              }}
              onClick={isRowClickable ? () => onRowClick(row, virtualRow.index) : undefined}
              onKeyDown={(event) => handleRowKeyDown(event, row, virtualRow.index)}
              tabIndex={isRowClickable ? 0 : undefined}
            >
              {columns.map((column) => (
                <div
                  key={column.key}
                  role="cell"
                  className={cn("px-3 py-2 text-sm", column.cellClassName)}
                >
                  {column.render ? column.render(row, virtualRow.index) : row[column.key]}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedTable;
