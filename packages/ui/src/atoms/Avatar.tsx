import React, { useState } from 'react';
import styles from './Avatar.module.css';

interface AvatarProps {
  src?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  status?: 'online' | 'offline' | 'busy';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name = '?',
  size = 'md',
  status,
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);

  const showImage = src && !imgError;

  return (
    <div className={`${styles.wrapper} ${className}`}>
      <div
        className={`${styles.avatar} ${styles[size]}`}
        role="img"
        aria-label={name}
      >
        {showImage ? (
          <img
            src={src}
            alt={name}
            className={styles.image}
            onError={() => setImgError(true)}
          />
        ) : (
          <span className={styles.initials}>{initials}</span>
        )}
      </div>
      {status && (
        <span
          className={`${styles.status} ${styles[status]}`}
          aria-label={status}
        />
      )}
    </div>
  );
};
