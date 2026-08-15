import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { useConfig } from '@/renderer/hooks/config/useConfig';

const OFFICE_AUTO_PREVIEW_TRIGGER_TYPES = new Set(['tool_group', 'tool_call', 'acp_tool_call']);

export const isOfficeAutoPreviewTriggerMessage = (message: Pick<IResponseMessage, 'type'>): boolean =>
  OFFICE_AUTO_PREVIEW_TRIGGER_TYPES.has(message.type);

export const findNewOfficeFiles = (currentFiles: string[], knownFiles: Set<string>): string[] =>
  currentFiles.filter((file_path) => !knownFiles.has(file_path));

/**
 * Whether a newly created Office file should open itself in front of the user.
 *
 * Off unless they turned it on, and the default is the point. A task that
 * wrote four spreadsheets used to take the screen four times from somebody who
 * had asked for the spreadsheets and not for a slideshow of them being made —
 * each preview arriving a second after the file appeared, over whatever they
 * had moved on to.
 *
 * The capability is kept and only the assumption is dropped. The assistant
 * opens a document the moment it is asked to, through `app_open_document`;
 * a file existing is not by itself a request to be shown it.
 */
export const useAutoPreviewOfficeFilesEnabled = (): boolean => {
  const [enabled] = useConfig('system.autoPreviewOfficeFiles');
  return enabled ?? false;
};
