import React from 'react';
import { Modal } from '../atoms/Modal';
import { Button } from '../atoms/Button';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
}) => {
  const buttonVariant = variant === 'danger' ? 'danger' : 'primary';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={buttonVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={styles.message}>{message}</p>
    </Modal>
  );
};
