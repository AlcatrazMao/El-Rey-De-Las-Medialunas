import React from 'react';
import styles from './Spinner.module.css';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
}

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md' }) => (
  <div
    className={`${styles.spinner} ${styles[size]}`}
    aria-label="Loading"
    role="status"
  />
);
