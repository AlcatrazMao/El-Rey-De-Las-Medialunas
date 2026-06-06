import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '../atoms/Icon';
import styles from './SearchInput.module.css';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  onSearch?: (value: string) => void;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  debounceMs = 300,
  onSearch,
}) => {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (onSearch) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onSearch(localValue);
      }, debounceMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [localValue, debounceMs, onSearch]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setLocalValue(v);
      onChange(v);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && onSearch) {
        if (timerRef.current) clearTimeout(timerRef.current);
        onSearch(localValue);
      }
      if (e.key === 'Escape') {
        setLocalValue('');
        onChange('');
        inputRef.current?.blur();
      }
    },
    [localValue, onChange, onSearch]
  );

  const handleClear = useCallback(() => {
    setLocalValue('');
    onChange('');
    if (timerRef.current) clearTimeout(timerRef.current);
    if (onSearch) onSearch('');
    inputRef.current?.focus();
  }, [onChange, onSearch]);

  return (
    <div className={styles.wrapper}>
      <Icon name="search" size="sm" className={styles.searchIcon} />
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {localValue && (
        <button
          className={styles.clearButton}
          onClick={handleClear}
          aria-label="Clear search"
          type="button"
        >
          <Icon name="close" size="sm" />
        </button>
      )}
    </div>
  );
};
