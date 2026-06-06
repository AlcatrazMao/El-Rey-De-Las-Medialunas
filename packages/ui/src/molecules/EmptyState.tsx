import React from 'react';
import { Icon, IconName } from '../atoms/Icon';
import { Button } from '../atoms/Button';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'inventory',
  title,
  description,
  actionLabel,
  onAction,
}) => (
  <div className={styles.container}>
    <Icon name={icon} size="lg" className={styles.emptyIcon} />
    <h3 className={styles.title}>{title}</h3>
    {description && <p className={styles.description}>{description}</p>}
    {actionLabel && onAction && (
      <Button variant="primary" onClick={onAction}>
        {actionLabel}
      </Button>
    )}
  </div>
);
