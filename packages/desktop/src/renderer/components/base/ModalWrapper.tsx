import type { ModalProps } from '@arco-design/web-react';
import { Modal, Button } from '@arco-design/web-react';
import { Close } from '@icon-park/react';
import React from 'react';

interface ModalWrapperProps extends Omit<ModalProps, 'title'> {
  children?: React.ReactNode;
  title?: React.ReactNode;
  showCustomClose?: boolean;
}

const ModalWrapper: React.FC<ModalWrapperProps> = ({
  children,
  title,
  showCustomClose = true,
  onCancel,
  className = '',
  ...props
}) => {
  return (
    <Modal {...props} title={null} closable={false} onCancel={onCancel} className={`fool-modal ${className}`}>
      <div>
        {showCustomClose && title && (
          <div className='fool-modal-header'>
            <h3 className='fool-modal-title'>{title}</h3>
            <Button
              type='text'
              shape='circle'
              size='small'
              icon={<Close size={20} fill='currentColor' />}
              onClick={onCancel}
              className='fool-modal-close-btn'
            />
          </div>
        )}
        {children}
      </div>
    </Modal>
  );
};

export default ModalWrapper;
