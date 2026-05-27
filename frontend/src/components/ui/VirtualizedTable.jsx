import { useMemo, useRef } from 'react';
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';

/* oxlint-disable react-doctor/prefer-tag-over-role --
 * This component intentionally exposes ARIA table semantics over virtualized
 * CSS grid rows. Native table tags do not support the absolute-positioned
 * virtualizer layout used here.
 */

const EMPTY_ROWS = [];
const EMPTY_COLUMNS = [];

function parsePixelWidth(width) {
  if (typeof width !== 'string') return null;

  const match = width.trim().match(/^(\d+(?:\.\d+)?)px$/);
  if (!match) return null;

  return Number(match[1]);
}

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
  rows = EMPTY_ROWS,
  columns = EMPTY_COLUMNS,
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
  const columnMetrics = useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        pixelWidth: parsePixelWidth(column.width),
      })),
    [columns]
  );
  const totalPixelWidth = useMemo(
    () => columnMetrics.reduce((sum, column) => sum + (column.pixelWidth || 0), 0),
    [columnMetrics]
  );
  const gridTemplateColumns = useMemo(
    () =>
      columnMetrics
        .map((column) => {
          if (column.pixelWidth) {
            return `minmax(0, ${Math.max(column.pixelWidth, 1)}fr)`;
          }
          return column.width || 'minmax(0, 1fr)';
        })
        .join(' '),
    [columnMetrics]
  );

  const shouldVirtualize = hasRows && rows.length >= threshold;
  const isRowClickable = typeof onRowClick === 'function';
  const desktopSurfaceStyle = totalPixelWidth
    ? { minWidth: `${Math.round(totalPixelWidth)}px` }
    : undefined;

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

  const containerStyle = useWindow
    ? { minWidth: 0, maxWidth: '100%', width: '100%' }
    : {
        height,
        overflow: 'auto',
        minWidth: 0,
        maxWidth: '100%',
        width: '100%',
      };

  if (!shouldVirtualize) {
    return (
      <div
        className={cn("rounded-lg border border-border/60 overflow-x-auto", className)}
        style={containerStyle}
      >
        <div role="table" style={desktopSurfaceStyle}>
          <div
            role="row"
            className={cn("grid bg-muted/50 text-xs font-mono", headerClassName)}
            style={{ gridTemplateColumns }}
          >
            {columnMetrics.map((column) => (
              <div
                key={column.key}
                role="columnheader"
                className={cn("min-w-0 px-3 py-2 text-muted-foreground", column.headerClassName)}
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
                {columnMetrics.map((column) => (
                  <div
                    key={column.key}
                    role="cell"
                    className={cn("min-w-0 px-3 py-2 text-sm", column.cellClassName)}
                  >
                    {column.render ? column.render(row, index) : row[column.key]}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={cn("rounded-lg border border-border/60 overflow-x-auto", className)}
      style={containerStyle}
    >
      <div role="table" style={desktopSurfaceStyle}>
        <div
          role="row"
          className={cn("grid bg-muted/50 text-xs font-mono sticky top-0 z-10", headerClassName)}
          style={{ gridTemplateColumns }}
        >
          {columnMetrics.map((column) => (
            <div
              key={column.key}
              role="columnheader"
              className={cn("min-w-0 px-3 py-2 text-muted-foreground", column.headerClassName)}
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
                data-index={virtualRow.index}
                role="presentation"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start - virtualScrollMargin}px)`,
                }}
              >
                <div
                  role="row"
                  className={cn("grid border-t border-border/50", resolveRowClassName(row, virtualRow.index))}
                  style={{ gridTemplateColumns }}
                  onClick={isRowClickable ? () => onRowClick(row, virtualRow.index) : undefined}
                  onKeyDown={(event) => handleRowKeyDown(event, row, virtualRow.index)}
                  tabIndex={isRowClickable ? 0 : undefined}
                >
                  {columnMetrics.map((column) => (
                    <div
                      key={column.key}
                      role="cell"
                      className={cn("min-w-0 px-3 py-2 text-sm", column.cellClassName)}
                    >
                      {column.render ? column.render(row, virtualRow.index) : row[column.key]}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default VirtualizedTable;
