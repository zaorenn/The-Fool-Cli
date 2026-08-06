/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageToolCall } from '@/common/chat/chatLib';
import { normalizeToolCall } from '@/common/chat/normalizeToolCall';
import type { NormalizedToolStatus } from '@/common/chat/normalizeToolCall';
import FileChangesPanel from '@/renderer/components/base/FileChangesPanel';
import { useDiffPreviewHandlers } from '@/renderer/hooks/file/useDiffPreviewHandlers';
import { parseDiff } from '@/renderer/utils/file/diffUtils';
import { Badge } from '@arco-design/web-react';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import { createTwoFilesPatch } from 'diff';
import React, { useMemo, useState } from 'react';
import type { BadgeProps } from '@arco-design/web-react';
import './MessageToolGroupSummary.css';

const statusToBadge = (status: NormalizedToolStatus): BadgeProps['status'] => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    default:
      return 'default';
  }
};

const ReplacePreview: React.FC<{ message: IMessageToolCall }> = ({ message }) => {
  const file_path = message.content.args?.file_path || message.content.input?.file_path || '';
  const old_string = message.content.args?.old_string ?? message.content.input?.old_string ?? '';
  const new_string = message.content.args?.new_string ?? message.content.input?.new_string ?? '';

  const diffText = useMemo(() => {
    return createTwoFilesPatch(file_path, file_path, old_string, new_string, '', '', { context: 3 });
  }, [file_path, old_string, new_string]);

  const fileInfo = useMemo(() => parseDiff(diffText, file_path), [diffText, file_path]);
  const display_name = file_path.split(/[/\\]/).pop() || file_path;
  const { handleFileClick, handleDiffClick } = useDiffPreviewHandlers({ diffText, display_name, file_path });

  return (
    <FileChangesPanel
      title={fileInfo.file_name}
      files={[fileInfo]}
      onFileClick={handleFileClick}
      onDiffClick={handleDiffClick}
      defaultExpanded={true}
    />
  );
};

const ComputerUsePreview: React.FC<{ imagePath: string; inputStr?: string }> = ({ imagePath, inputStr }) => {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  let coordinate: [number, number] | null = null;
  if (inputStr) {
    try {
      const parsed = JSON.parse(inputStr);
      if (parsed.coordinate && Array.isArray(parsed.coordinate)) {
        coordinate = [parsed.coordinate[0], parsed.coordinate[1]];
      }
    } catch (e) {}
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '400px',
        overflow: 'hidden',
        borderRadius: '6px',
        border: '1px solid var(--color-border)',
      }}
      className='m-t-8px'
    >
      <img
        src={imagePath}
        style={{ width: '100%', display: 'block' }}
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        alt='Computer Use Screen'
      />
      {size && coordinate && (
        <div
          style={{
            position: 'absolute',
            left: `${(coordinate[0] / size.w) * 100}%`,
            top: `${(coordinate[1] / size.h) * 100}%`,
            width: 24,
            height: 24,
            marginLeft: -12,
            marginTop: -12,
            backgroundColor: 'rgba(255, 50, 50, 0.4)',
            border: '2px solid #ff3232',
            borderRadius: '50%',
            pointerEvents: 'none',
            boxShadow: '0 0 0 1.5px white',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
};

const MessageToolCall: React.FC<{ message: IMessageToolCall }> = ({ message }) => {
  const { name } = message.content;
  const [expanded, setExpanded] = useState(false);

  if (name === 'replace' || name === 'Edit') {
    return <ReplacePreview message={message} />;
  }

  const normalized = normalizeToolCall(message);
  if (!normalized) {
    return <div className='text-t-primary'>{name}</div>;
  }

  const hasDetail = normalized.input || normalized.output || normalized.imagePath;

  // Auto-expand if there's an image
  React.useEffect(() => {
    if (normalized.imagePath && !expanded) {
      setExpanded(true);
    }
  }, [normalized.imagePath]);

  return (
    <div className='flex flex-col'>
      <div className='flex flex-row color-#86909C gap-12px items-center'>
        <Badge
          status={statusToBadge(normalized.status)}
          className={normalized.status === 'running' ? 'badge-breathing' : ''}
        />
        <span
          className={
            'flex-1 min-w-0' +
            (expanded ? ' break-all' : ' truncate') +
            (hasDetail ? ' cursor-pointer hover:color-#4E5969' : '')
          }
          onClick={hasDetail ? () => setExpanded(!expanded) : undefined}
        >
          <span className='font-medium text-13px'>{normalized.name}</span>
          {normalized.description && <span className='m-l-4px opacity-80 text-13px'>{normalized.description}</span>}
        </span>
        {hasDetail && (
          <span
            className='flex-shrink-0 cursor-pointer hover:color-#4E5969 transition-colors'
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />}
          </span>
        )}
      </div>
      {expanded && hasDetail && (
        <div className='tool-detail-panel m-l-20px m-t-4px'>
          {normalized.imagePath && <ComputerUsePreview imagePath={normalized.imagePath} inputStr={normalized.input} />}
          <div className='text-13px color-#4E5969 break-all whitespace-pre-wrap bg-2 p-8px rounded-4px m-t-8px'>
            {normalized.input && (
              <div className='tool-detail-section'>
                <div className='tool-detail-label'>Input</div>
                <pre className='tool-detail-content'>{normalized.input}</pre>
              </div>
            )}
            {normalized.output && (
              <div className='tool-detail-section'>
                <div className='tool-detail-label'>Output</div>
                <pre className='tool-detail-content'>{normalized.output}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageToolCall;
