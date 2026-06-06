import React from 'react';
import styles from './Card.module.css';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  subtitle,
  headerAction,
  footer,
  padding = 'md',
  className = '',
}) => (
  <div className={`${styles.card} ${className}`}>
    {(title || subtitle || headerAction) && (
      <div className={styles.header}>
        <div className={styles.headerTitles}>
          {title && <h3 className={styles.title}>{title}</h3>}
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {headerAction && (
          <div className={styles.headerAction}>{headerAction}</div>
        )}
      </div>
    )}
    <div className={`${styles.body} ${styles[`pad-${padding}`]}`}>
      {children}
    </div>
    {footer && <div className={styles.footer}>{footer}</div>}
  </div>
);
