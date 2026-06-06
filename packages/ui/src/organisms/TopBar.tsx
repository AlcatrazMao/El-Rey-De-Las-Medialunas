import React, { useState, useEffect, useRef } from 'react';
import { Avatar } from '../atoms/Avatar';
import { Icon } from '../atoms/Icon';
import { Badge } from '../atoms/Badge';
import styles from './TopBar.module.css';

interface Branch {
  id: string;
  name: string;
}

interface TopBarProps {
  branchName?: string;
  branches?: Branch[];
  onBranchChange?: (branchId: string) => void;
  userName?: string;
  userRole?: string;
  onLogout?: () => void;
  onSettings?: () => void;
  onToggleSidebar?: () => void;
  isOnline?: boolean;
  pendingSyncCount?: number;
  clock?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  branchName,
  branches,
  onBranchChange,
  userName,
  userRole,
  onLogout,
  onSettings,
  onToggleSidebar,
  isOnline,
  pendingSyncCount = 0,
  clock = true,
}) => {
  const [time, setTime] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clock) return;
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [clock]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const status = isOnline ? 'online' : 'offline';

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        {onToggleSidebar && (
          <button
            className={styles.hamburger}
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
          >
            <Icon name="minus" size="md" />
          </button>
        )}
        {branches && branches.length > 0 ? (
          <select
            className={styles.branchSelect}
            value={branches.find((b) => b.name === branchName)?.id || ''}
            onChange={(e) => onBranchChange?.(e.target.value)}
            aria-label="Select branch"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          branchName && (
            <span className={styles.branchLabel}>{branchName}</span>
          )
        )}
      </div>

      <div className={styles.right}>
        {pendingSyncCount > 0 && (
          <span className={styles.syncBadge} title="Pending sync">
            <Badge variant={isOnline ? 'warning' : 'neutral'} mode="counter">
              {pendingSyncCount}
            </Badge>
          </span>
        )}
        {typeof isOnline !== 'undefined' && (
          <span
            className={styles.connectionStatus}
            title={isOnline ? 'Online' : 'Offline'}
          >
            <Icon name={isOnline ? 'wifi' : 'wifiOff'} size="sm" />
          </span>
        )}
        {clock && time && (
          <span className={styles.clock}>{time}</span>
        )}
        {userName && (
          <div className={styles.userMenu} ref={userMenuRef}>
            <button
              className={styles.userButton}
              onClick={() => setUserMenuOpen((prev) => !prev)}
              aria-expanded={userMenuOpen}
              aria-haspopup="true"
            >
              <Avatar name={userName} size="sm" status={status} />
              <span className={styles.userName}>{userName}</span>
              <Icon name="chevronDown" size="sm" />
            </button>
            {userMenuOpen && (
              <div className={styles.dropdown} role="menu">
                <div className={styles.dropdownHeader}>
                  <span className={styles.dropdownName}>{userName}</span>
                  {userRole && (
                    <span className={styles.dropdownRole}>{userRole}</span>
                  )}
                </div>
                <div className={styles.dropdownDivider} />
                {onSettings && (
                  <button
                    className={styles.dropdownItem}
                    onClick={() => {
                      onSettings();
                      setUserMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    <Icon name="settings" size="sm" />
                    Settings
                  </button>
                )}
                {onLogout && (
                  <button
                    className={styles.dropdownItem}
                    onClick={() => {
                      onLogout();
                      setUserMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    <Icon name="logout" size="sm" />
                    Logout
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
