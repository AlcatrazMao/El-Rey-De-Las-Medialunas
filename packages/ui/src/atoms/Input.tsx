import React, { InputHTMLAttributes } from 'react';
import styles from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
  variant?: 'outlined' | 'filled';
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  variant = 'outlined',
  id,
  className = '',
  ...props
}) => {
  const inputId = id || `input-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className={`${styles.container} ${className}`}>
      <label htmlFor={inputId} className={styles.label}>{label}</label>
      <input
        id={inputId}
        className={`${styles.input} ${styles[variant]} ${error ? styles.error : ''}`}
        {...props}
      />
      {error ? (
        <span className={styles.errorText}>{error}</span>
      ) : helperText ? (
        <span className={styles.helperText}>{helperText}</span>
      ) : null}
    </div>
  );
};
