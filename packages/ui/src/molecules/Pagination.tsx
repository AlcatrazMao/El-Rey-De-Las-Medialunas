import React from 'react';

import styles from './Pagination.module.css';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const getPageNumbers = (): (number | 'ellipsis')[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | 'ellipsis')[] = [1];
    if (page > 3) pages.push('ellipsis');
    const from = Math.max(2, page - 1);
    const to = Math.min(totalPages - 1, page + 1);
    for (let i = from; i <= to; i++) pages.push(i);
    if (page < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  };

  if (total === 0) {
    return (
      <div className={styles.container}>
        <span className={styles.info}>No results</span>
      </div>
    );
  }

  const pageNumbers = getPageNumbers();

  return (
    <div className={styles.container}>
      <div className={styles.info}>
        Showing {start}-{end} of {total} results
      </div>
      <div className={styles.controls}>
        <select
          className={styles.select}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="Page size"
        >
          {pageSizeOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt} per page
            </option>
          ))}
        </select>
        <div className={styles.buttons}>
          <button
            className={styles.pageButton}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            &lt;
          </button>
          {pageNumbers.map((p, i) =>
            p === 'ellipsis' ? (
              <span key={`e-${i}`} className={styles.ellipsis}>
                ...
              </span>
            ) : (
              <button
                key={p}
                className={`${styles.pageButton} ${
                  p === page ? styles.active : ''
                }`}
                onClick={() => onPageChange(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? 'page' : undefined}
              >
                {p}
              </button>
            )
          )}
          <button
            className={styles.pageButton}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            &gt;
          </button>
        </div>
      </div>
    </div>
  );
};
