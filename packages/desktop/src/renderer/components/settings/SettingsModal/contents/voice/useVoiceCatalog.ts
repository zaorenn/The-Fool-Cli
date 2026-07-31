/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { VoiceDownloadProgress, VoiceModel, VoiceProfile } from '@/common/types/foolVoice';
import { verifyVoiceModel, type VerifyResult } from './voiceModelActions';

export type InstallErrorCode = Extract<VoiceDownloadProgress, { state: 'failed' }>['errorCode'];

export type InstallState = {
  /** `pending` is local: set the moment the button is pressed, before the first event. */
  phase: 'pending' | 'downloading' | 'extracting' | 'validating' | 'failed';
  downloadedBytes: number;
  totalBytes: number | null;
  errorCode?: InstallErrorCode;
};

export type VerificationState = 'checking' | VerifyResult['status'];

export type VoiceCatalogHandle = {
  models: readonly VoiceModel[];
  profiles: readonly VoiceProfile[];
  loadFailed: boolean;
  /** Live install state per model id; absent means idle. */
  installs: Readonly<Record<string, InstallState>>;
  verifications: Readonly<Record<string, VerificationState>>;
  install: (modelId: string) => void;
  verify: (modelId: string) => void;
  /** Re-reads the catalog and hands back the fresh list for callers that need it. */
  refresh: () => Promise<readonly VoiceModel[]>;
};

const newRequestId = () => `voice-catalog-${crypto.randomUUID()}`;

const unwrap = <T>(envelope: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

/**
 * The installed-model view behind Voice settings.
 *
 * Install is deliberately guarded in three places: a model that is already
 * installed is never downloaded again, a model already being downloaded is not
 * started twice, and the button goes busy on click rather than when the first
 * progress event arrives — a gap that was wide enough to press twice.
 */
export const useVoiceCatalog = (): VoiceCatalogHandle => {
  const [models, setModels] = useState<readonly VoiceModel[]>([]);
  const [profiles, setProfiles] = useState<readonly VoiceProfile[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [installs, setInstalls] = useState<Record<string, InstallState>>({});
  const [verifications, setVerifications] = useState<Record<string, VerificationState>>({});

  // Read inside callbacks that must not be re-created on every state change.
  const modelsRef = useRef<readonly VoiceModel[]>([]);
  const installsRef = useRef<Record<string, InstallState>>({});
  const profilesRef = useRef<readonly VoiceProfile[]>([]);
  modelsRef.current = models;
  installsRef.current = installs;
  profilesRef.current = profiles;

  const refresh = useCallback(async (): Promise<readonly VoiceModel[]> => {
    try {
      const catalog = unwrap(
        await ipcBridge.foolVoice.catalog.invoke({
          version: 1,
          requestId: newRequestId(),
          payload: { includeProfiles: true },
        })
      );
      setModels(catalog.models);
      setProfiles(catalog.profiles);
      setLoadFailed(false);
      // Returned as well as stored: a caller that acts on the result cannot wait
      // for the next render to see it.
      return catalog.models;
    } catch {
      setLoadFailed(true);
      return modelsRef.current;
    }
  }, []);

  useEffect(() => {
    void refresh();

    const unsubscribe = ipcBridge.foolVoice.downloadProgress.on((event) => {
      const progress = event.payload;

      const running = (phase: InstallState['phase']) =>
        setInstalls((previous) => ({
          ...previous,
          [progress.modelId]: {
            phase,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
          },
        }));

      switch (progress.state) {
        case 'ready':
        case 'cancelled':
          setInstalls(({ [progress.modelId]: _finished, ...rest }) => rest);
          // The model's own state comes from disk, so re-read rather than assume.
          void refresh();
          return;
        case 'failed':
          setInstalls((previous) => ({
            ...previous,
            [progress.modelId]: {
              phase: 'failed',
              downloadedBytes: progress.downloadedBytes,
              totalBytes: progress.totalBytes,
              errorCode: progress.errorCode,
            },
          }));
          // A failure can leave a half-extracted directory; show its real state.
          void refresh();
          return;
        case 'queued':
          running('pending');
          return;
        case 'downloading':
        case 'extracting':
        case 'validating':
          running(progress.state);
          return;
      }
    });

    return () => unsubscribe();
  }, [refresh]);

  const install = useCallback((modelId: string) => {
    const active = installsRef.current[modelId];
    if (active && active.phase !== 'failed') return;

    const model = modelsRef.current.find((candidate) => candidate.id === modelId);
    if (model?.distribution === 'managed' && model.state.status === 'ready') return;

    setInstalls((previous) => ({
      ...previous,
      [modelId]: { phase: 'pending', downloadedBytes: 0, totalBytes: null },
    }));

    const operationId = newRequestId();
    void ipcBridge.foolVoice.download
      .invoke({ version: 1, requestId: operationId, payload: { operationId, providerId: 'local-sherpa', modelId } })
      .then((response) => {
        if (response.ok === false) throw new Error(response.error.code);
      })
      .catch(() => {
        setInstalls((previous) => ({
          ...previous,
          [modelId]: { phase: 'failed', downloadedBytes: 0, totalBytes: null },
        }));
      });
  }, []);

  const verify = useCallback(
    (modelId: string) => {
      const model = modelsRef.current.find((candidate) => candidate.id === modelId);
      if (!model) return;

      // A cloning model lists no voices of its own — it borrows one. Checking it
      // means speaking with a recording the user has cloned; asked to speak with
      // nothing to imitate, the engine has no voice at all.
      //
      // Only a speaking model carries `profileIds`; a transcriber has no voices
      // to list and nothing to borrow.
      const borrowedProfileId =
        model.role === 'text-to-speech' && model.profileIds.length === 0
          ? profilesRef.current.find((profile) => profile.modelId === modelId && profile.kind === 'cloned')?.id
          : undefined;

      setVerifications((previous) => ({ ...previous, [modelId]: 'checking' }));
      // Re-read the catalog first: the files may have appeared or vanished since
      // this page was opened.
      void refresh()
        .then((fresh) =>
          verifyVoiceModel(fresh.find((candidate) => candidate.id === modelId) ?? model, borrowedProfileId)
        )
        .then((result) => setVerifications((previous) => ({ ...previous, [modelId]: result.status })))
        .catch(() => setVerifications((previous) => ({ ...previous, [modelId]: 'unusable' })));
    },
    [refresh]
  );

  return { models, profiles, loadFailed, installs, verifications, install, verify, refresh };
};
