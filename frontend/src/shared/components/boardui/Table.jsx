import { forwardRef } from 'react';
import { Cell, Column, Row, Table as AriaTable, TableBody, TableHeader } from 'react-aria-components';
import { cn } from '@/lib/utils';
import './table.css';

// Adapted from the official BoardUI Table. Collection parts must stay direct
// exports: React Aria inspects them before rendering. See README.md provenance.
export const Table = forwardRef(function Table({ size = 'md', className, containerClassName, ...props }, ref) {
  return <div className={cn('hms-boardui-table', containerClassName)}>
    <AriaTable ref={ref} {...props} className={cn('bui-table', size === 'sm' && 'bui-table-sm', className)} />
  </div>;
});

export { TableHeader, Column as TableColumn, TableBody, Row as TableRow, Cell as TableCell };
