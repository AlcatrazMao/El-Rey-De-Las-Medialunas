import React from 'react';

import { Icon } from '../atoms/Icon';
import { Spinner } from '../atoms/Spinner';

import styles from './DataTable.module.css';

interface ColumnDef<T> {
  key: keyof T & string;
  header: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  sortable?: boolean;
  onSort?: (column: string) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  };
  keyExtractor: (item: T) => string;
}

export const DataTable = <T extends Record<string, unknown>>({
  columns,
  data,
  loading,
  emptyMessage = 'No data available',
  sortable,
  onSort,
  sortColumn,
  sortDirection,
  selectable,
  selectedIds,
  onSelectionChange,
  pagination,
  keyExtractor,
}: DataTableProps<T>) => {
  const allSelected =
    selectable && data.length > 0 && selectedIds?.size === data.length;
  const someSelected =
    selectable && selectedIds && selectedIds.size > 0 && !allSelected;

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(data.map((item) => keyExtractor(item))));
    }
  };

  const handleSelectRow = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  };

  if (loading) {
    return (
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              {selectable && <th className={styles.checkboxCol} />}
              {columns.map((col) => (
                <th key={col.key} style={{ width: col.width }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((i) => (
              <tr key={i}>
                {selectable && (
                  <td className={styles.checkboxCol}>
                    <div className={styles.skeleton} />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key}>
                    <div className={styles.skeleton} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.loadingOverlay}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyMessage}>{emptyMessage}</p>
      </div>
    );
  }

  const start = pagination
    ? (pagination.page - 1) * pagination.pageSize + 1
    : 1;
  const end = pagination
    ? Math.min(pagination.page * pagination.pageSize, pagination.total)
    : data.length;

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {selectable && (
              <th className={styles.checkboxCol}>
                <input
                  type="checkbox"
                  checked={allSelected || false}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected || false;
                  }}
                  onChange={handleSelectAll}
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.sortable && sortable ? styles.sortable : ''}
                style={{ width: col.width }}
                onClick={() => {
                  if (col.sortable && sortable && onSort) {
                    onSort(col.key);
                  }
                }}
              >
                <span className={styles.headerContent}>
                  {col.header}
                  {col.sortable && sortable && sortColumn === col.key && (
                    <Icon
                      name={
                        sortDirection === 'asc' ? 'chevronUp' : 'chevronDown'
                      }
                      size="sm"
                      className={styles.sortIcon}
                    />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const id = keyExtractor(row);
            const isSelected = selectedIds?.has(id) || false;
            return (
              <tr
                key={id}
                className={`${i % 2 === 0 ? styles.even : styles.odd} ${
                  isSelected ? styles.selected : ''
                }`}
              >
                {selectable && (
                  <td className={styles.checkboxCol}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleSelectRow(id)}
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key}>
                    {col.render
                      ? col.render(row[col.key], row)
                      : (row[col.key] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {pagination && (
        <div className={styles.paginationInfo}>
          Showing {start}-{end} of {pagination.total} results
        </div>
      )}
    </div>
  );
};

export type { ColumnDef };
