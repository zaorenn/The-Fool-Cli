/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RunEvidence } from '@renderer/services/voice/narration/FoolNarrator';

/**
 * The window events voice uses to talk to the rest of the app.
 *
 * Deliberately a module with no imports of its own beyond a type: the composers
 * that listen for these names should not have to pull in the voice session, the
 * IPC bridge and the i18n runtime just to know what a string is called.
 */

/** A spoken turn, before anything has decided where it goes. */
export const VOICE_TURN_EVENT = 'fool:voice-turn';

/** Dispatched at a conversation's composer, which sends into that conversation. */
export const VOICE_SUBMIT_EVENT = 'fool:voice-submit';

/** Dispatched at the home composer, which opens a new chat and sends into it. */
export const VOICE_HOME_SUBMIT_EVENT = 'fool:voice-home-submit';

/** Raised when a turn finishes, carrying the answer to be spoken. */
export const VOICE_REPLY_EVENT = 'fool:voice-reply';

export type VoiceSubmitDetail = { text: string };

export type VoiceReplyDetail = { answer: string; evidence?: RunEvidence };
