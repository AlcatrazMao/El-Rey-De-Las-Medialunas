import React from 'react';

import styles from './Badge.module.css';

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  mode?: 'dot' | 'counter' | 'label';
  children?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  mode = 'label',
  children,
}) => {
  return (
    <span className={`${styles.badge} ${styles[variant]} ${styles[mode]}`}>
      {mode === 'dot' ? null : children}
    </span>
  );
};
