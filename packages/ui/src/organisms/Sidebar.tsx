import React, { useState } from 'react';
import { Icon, type IconName } from '../atoms/Icon';
import { Badge } from '../atoms/Badge';
import styles from './Sidebar.module.css';

interface SidebarItem {
  id: string;
  label: string;
  icon: IconName;
  path?: string;
  children?: SidebarItem[];
  badge?: number;
}

interface SidebarProps {
  items: SidebarItem[];
  collapsed?: boolean;
  onToggle?: () => void;
  activePath?: string;
  onNavigate?: (path: string) => void;
}

const SidebarItemComponent: React.FC<{
  item: SidebarItem;
  depth: number;
  collapsed: boolean;
  activePath?: string;
  onNavigate?: (path: string) => void;
}> = ({ item, depth, collapsed, activePath, onNavigate }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;
  const isActive = item.path ? item.path === activePath : false;
  const childActive = item.children?.some(
    (c) =>
      c.path === activePath ||
      c.children?.some((cc) => cc.path === activePath)
  );

  const handleClick = () => {
    if (hasChildren) {
      setExpanded((prev) => !prev);
    } else if (item.path && onNavigate) {
      onNavigate(item.path);
    }
  };

  return (
    <li className={styles.item}>
      <button
        className={`${styles.navButton} ${isActive || childActive ? styles.active : ''} ${
          collapsed ? styles.collapsedButton : ''
        }`}
        onClick={handleClick}
        style={{ paddingLeft: collapsed ? undefined : `${12 + depth * 16}px` }}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-current={isActive ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
      >
        <Icon name={item.icon} size="sm" className={styles.navIcon} />
        {!collapsed && (
          <>
            <span className={styles.navLabel}>{item.label}</span>
            <span className={styles.navRight}>
              {item.badge !== undefined && item.badge > 0 && (
                <Badge variant="danger" mode="counter">
                  {item.badge}
                </Badge>
              )}
              {hasChildren && (
                <Icon
                  name={expanded ? 'chevronDown' : 'chevronRight'}
                  size="sm"
                  className={styles.expandIcon}
                />
              )}
            </span>
          </>
        )}
      </button>
      {hasChildren && expanded && !collapsed && (
        <ul className={styles.subItems}>
          {item.children!.map((child) => (
            <SidebarItemComponent
              key={child.id}
              item={child}
              depth={depth + 1}
              collapsed={collapsed}
              activePath={activePath}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  items,
  collapsed = false,
  onToggle,
  activePath,
  onNavigate,
}) => (
  <aside
    className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}
    role="navigation"
    aria-label="Main navigation"
  >
    {onToggle && (
      <button
        className={styles.toggle}
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size="md" />
      </button>
    )}
    <nav>
      <ul className={styles.nav}>
        {items.map((item) => (
          <SidebarItemComponent
            key={item.id}
            item={item}
            depth={0}
            collapsed={collapsed}
            activePath={activePath}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </nav>
  </aside>
);

export type { SidebarItem };
