/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { geminiLiveAdapter, GEMINI_LIVE_DEFAULT_MODEL, GEMINI_LIVE_VOICES } from './geminiLive';
import { localS2SAdapter, LOCAL_S2S_ENDPOINT } from './localS2S';
import { openAIRealtimeAdapter, OPENAI_REALTIME_DEFAULT_MODEL, OPENAI_REALTIME_VOICES } from './openaiRealtime';
import type { RealtimeAdapter, RealtimeProviderId, RealtimeToolSchema, VoiceConversationProviderId } from './types';

const ADAPTERS: Record<RealtimeProviderId, RealtimeAdapter> = {
  'openai-realtime': openAIRealtimeAdapter,
  'gemini-live': geminiLiveAdapter,
  'local-s2s': localS2SAdapter,
};

export const getRealtimeAdapter = (providerId: RealtimeProviderId): RealtimeAdapter => ADAPTERS[providerId];

/**
 * What each provider needs from the settings page, in one place.
 *
 * The page offers a voice list and a model, and neither is shared: OpenAI's
 * voices are called `marin` and `cedar`, Gemini's are called `Puck` and `Kore`,
 * and the local pipeline has whatever its own configuration gave it. A picker
 * that offered the union of those would let the user choose a voice that fails
 * at connection time with a message from the provider.
 *
 * `platform` is the id used by the app's own provider list, which is where the
 * API key comes from — an OpenAI realtime session is paid for by the same
 * account as an OpenAI chat, and asking the user to enter the key twice would
 * be inventing a second place for it to be wrong.
 */
export type RealtimeProviderSpec = {
  id: VoiceConversationProviderId;
  /** Provider platforms whose credentials can open this kind of session. */
  platforms: readonly string[];
  defaultModel: string;
  voices: readonly string[];
  defaultVoice: string;
  /** True when the session needs an API key from the app's provider list. */
  requiresCredential: boolean;
};

export const REALTIME_PROVIDER_SPECS: Record<VoiceConversationProviderId, RealtimeProviderSpec> = {
  'openai-realtime': {
    id: 'openai-realtime',
    platforms: ['openai', 'openai-compatible', 'azure-openai', 'new-api'],
    defaultModel: OPENAI_REALTIME_DEFAULT_MODEL,
    voices: OPENAI_REALTIME_VOICES,
    defaultVoice: 'marin',
    requiresCredential: true,
  },
  'gemini-live': {
    id: 'gemini-live',
    platforms: ['gemini', 'google', 'google-gemini', 'vertexai'],
    defaultModel: GEMINI_LIVE_DEFAULT_MODEL,
    voices: GEMINI_LIVE_VOICES,
    defaultVoice: 'Puck',
    requiresCredential: true,
  },
  'local-s2s': {
    id: 'local-s2s',
    platforms: [],
    defaultModel: 'local',
    voices: ['default'],
    defaultVoice: 'default',
    requiresCredential: false,
  },
  // No voice list of its own: it speaks with whatever text-to-speech model the
  // voice settings installed, including a cloned one, and duplicating that
  // picker here would be a second place to choose the same thing. The model
  // named here is the one that thinks, and it is whatever the local server has
  // loaded — which is why the default is empty rather than a guess.
  'local-pipeline': {
    id: 'local-pipeline',
    platforms: [],
    defaultModel: '',
    voices: [],
    defaultVoice: '',
    requiresCredential: false,
  },
};

/**
 * Picker order, most useful first.
 *
 * The local pipeline leads because it is the only one that works on a fresh
 * install with nothing bought.
 */
export const REALTIME_PROVIDER_IDS: readonly VoiceConversationProviderId[] = [
  'local-pipeline',
  'openai-realtime',
  'gemini-live',
  'local-s2s',
];

/**
 * The things the voice may do to the app while a conversation is happening.
 *
 * Deliberately short. A speech-to-speech model calling a tool has to stop
 * speaking to do it, so every entry here is a pause in the conversation and has
 * to be worth one — which rules out the long tail of app settings and leaves the
 * ones that come up out loud: look at the screen, do a real thing on the
 * computer, change how the app looks, and wait when told to.
 *
 * Seeing and doing are separate entries on purpose. They cost different amounts
 * — a look is a few seconds and changes nothing, a task is minutes and changes
 * the user's desktop — and a model given only the second one reaches for it to
 * answer "what's on my screen", which is a heavyweight way to do something it
 * could have done itself.
 */
export const REALTIME_TOOLS: readonly RealtimeToolSchema[] = [
  {
    name: 'app_theme',
    description:
      "Change how the app looks, keep a set of colours under a name, or put a kept one back on. Colours are yours to choose: the user describes what they want — warmer, deeper, like the sea, the colour of an old terminal — and you turn that into a hex value yourself. Only touch what they asked about; changing the background when they said 'accent' is a bigger change than they wanted. Say what you changed in a few words, and never read a hex code out loud.",
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['set', 'save', 'use', 'reset'],
          description:
            "'set' applies a colour now, 'save' keeps the current colours under a name, 'use' puts a saved one back on, 'reset' returns to the app's own colours.",
        },
        target: {
          type: 'string',
          enum: ['accent', 'background', 'surface', 'text'],
          description: "What the colour is for. Defaults to the accent, which is what 'the colour' usually means.",
        },
        color: {
          type: 'string',
          description: "A hex colour such as #1f6f8b, for 'set'. Choose it from what the user described.",
        },
        name: { type: 'string', description: "The user's own name for a palette, for 'save' and 'use'." },
      },
      required: ['action'],
    },
  },
  {
    name: 'app_look_at_screen',
    description:
      "Look at what is on the user's screen right now and get it back described in words. Call this whenever the user says to look at their screen, or asks about a page, a window, an error or anything they can see and you cannot — including 'summarise this page'. Looking takes a few seconds, so say you are looking before you call it, then tell the user what is there in your own words.",
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'What to look for, in a sentence. Leave out for a plain summary of the screen.',
        },
      },
      required: [],
    },
  },
  {
    name: 'app_open_url',
    description:
      "Open one or more web pages in the user's own default browser, each in a new tab of the browser they already have open. Pass every address you want open in a single call — 'open each of those in my browser' is one call with the whole list, not one call per page. Use this only when getting the addresses open is the whole request; anything that has to happen after a page loads (searching in it, clicking a result, playing something) is app_ask_jester's job. Say how many you are opening and what they are, in a few words; do not read the addresses out.",
    parameters: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Full addresses, including https://, in the order they should open. For a song or video, a YouTube search URL such as https://www.youtube.com/results?search_query=… with the query percent-encoded.',
        },
      },
      required: ['urls'],
    },
  },
  {
    name: 'app_search',
    description:
      "Search inside a site and put the results in front of the user, in one step. This is the whole of 'open YouTube and find that song', 'search GitHub for it', 'look it up on Wikipedia' — it goes straight to the site's own results page, so it happens instantly instead of taking the agent minutes of clicking. Use it for every request that ends in a search on a named site, and for a plain web search when no site was named. Say what you looked for and where, in a few words; do not read the address out. If they then want something done with a result — playing it, buying it, replying to it — that part is app_ask_jester.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "What to search for, in the user's own words." },
        site: {
          type: 'string',
          description:
            'Where to search: youtube, google, github, wikipedia, reddit, x, spotify, maps, amazon, stackoverflow, npm, imdb. A domain such as youtube.com works too. Leave out for a plain web search.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'app_ask_jester',
    description:
      "Do anything at all on this computer, through an agent that drives it. Opening and using applications, clicking, typing, searching inside a page that is already open, filling in forms, sending a message in Discord or an email, files, code, research. This is not a fixed list: it is the user's own machine, so anything they could do sitting at it can be asked for in a sentence. Use it for every request that changes something outside this conversation, including the second half of a request whose first half was opening a page. It runs while you keep talking, so say briefly that you are on it, and report the outcome in a sentence when it comes back. Do not use it merely to look at the screen; that is app_look_at_screen.",
    parameters: {
      type: 'object',
      properties: { request: { type: 'string', description: "The task, in the user's own words." } },
      required: ['request'],
    },
  },
  {
    name: 'app_build_app',
    description:
      "Build something the user asked for and put it in front of them. Use it whenever they ask you to make, build or design an app, a page, a site, a tool, a game or a dashboard — 'build me a web app, make it macOS style' is exactly this. It writes a real, working page, serves it locally and opens it in their own browser, so they are looking at it a moment after it is done; app_ask_jester would build the same thing and leave them with nowhere to see it. It runs for a few minutes while you keep talking, so say briefly that you are on it. When it comes back, say what you made in a sentence and that it is open — never read the address out.",
    parameters: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description:
            "What to build, in the user's own words, including anything they said about how it should look or what it should do.",
        },
      },
      required: ['request'],
    },
  },
  {
    name: 'app_settings',
    description:
      'Change how the assistant itself behaves, without the user having to leave the conversation and find a settings page. Use it whenever they say what they want changed: a different voice, a male or a female one, faster or slower speech, louder or quieter, what language you answer in, whether they have to hold a key to talk, whether tasks may run without asking, the word that cuts you off, the phrase that wakes you, and the layout of the page they are looking at. Say what you changed in a few words. For colours use app_theme instead; for anything outside this app use app_ask_jester.',
    parameters: {
      type: 'object',
      properties: {
        setting: {
          type: 'string',
          enum: [
            'voice',
            'speed',
            'volume',
            'reply_language',
            'persona',
            'hold_to_talk',
            'unattended',
            'interrupt_word',
            'wake_phrase',
            'thinking_model',
            'vision_model',
            'layout',
          ],
          description: 'Which one to change.',
        },
        value: {
          type: 'string',
          description:
            "The new value. For 'voice', an id from the list of installed voices you were given. For 'speed' and 'volume', a number — 1 is normal, 1.3 is faster. For 'reply_language', a language code such as en or tr, or 'auto' to follow whoever is speaking. For 'persona', one of companion, english-teacher, language-partner, interview-coach. For 'layout', the name of a layout — 'instrument' or 'hud' ship with the app, and the user may have saved others under their own names. For the on/off ones, 'on' or 'off'.",
        },
      },
      required: ['setting', 'value'],
    },
  },
  {
    name: 'app_remember',
    description:
      "Keep something about the person you are talking to, so it is still true in tomorrow's conversation. Use it the moment they tell you what to call them, what they are working on, how they like things done, what machine they are on, or anything else you would be embarrassed to ask twice. Also use it when something you already knew turns out to have changed. Do not ask permission to remember and do not read the memory back — note it in a few words at most and carry on talking.",
    parameters: {
      type: 'object',
      properties: {
        fact: {
          type: 'string',
          description:
            'One thing about them, written as a short statement you would want to read at the start of the next conversation. "Builds a desktop app called The Fool in the evenings." Leave out if there is nothing but a name to keep.',
        },
        callMe: {
          type: 'string',
          description:
            'What they want to be called, exactly as they said it. Set this only when they have said so — a name mentioned in passing is not an instruction to use it.',
        },
        word: {
          type: 'string',
          description:
            'One of their own words that does not mean what it says — "my desktop", "the project", "work". Set it with `means`, and only when they have told you what it stands for.',
        },
        means: {
          type: 'string',
          description:
            'What that word stands for, exactly enough to act on: a full folder path, a person\'s full name, the address of a site. "C:\\Users\\sarhen\\Desktop".',
        },
      },
      required: [],
    },
  },
  {
    name: 'app_learn',
    description:
      "Get better at working for this person. Two uses, and they are both about not making them say the same thing twice. Use `lesson` the moment they correct you, tell you that is not what they meant, or you find out something you did was wrong — write down what to do differently next time, in one sentence, without being asked. Use `skillName` with `skillSteps` when they are teaching you how they want something done: 'when I ask you to find a video, search YouTube and open the first result'. What you keep here is read back at the start of every future conversation and by any agent working on their behalf, so write it as an instruction to yourself rather than as a note about what happened.",
    parameters: {
      type: 'object',
      properties: {
        lesson: {
          type: 'string',
          description:
            'What to do differently, in one sentence. "When they say the desktop, they mean the folder, not the app." Leave out when you are recording a skill instead.',
        },
        skillName: {
          type: 'string',
          description: 'What they call this way of doing things, short enough to be a title. "Find a video".',
        },
        skillWhen: { type: 'string', description: 'When it applies, in their words. "When I ask you to play a song."' },
        skillSteps: {
          type: 'string',
          description: 'What to do, as the steps they described, in order.',
        },
      },
      required: [],
    },
  },
  {
    name: 'app_forget',
    description:
      'Drop something you were remembering, when they ask you to forget it or when it is simply no longer true. Say in a few words that it is gone.',
    parameters: {
      type: 'object',
      properties: {
        about: { type: 'string', description: 'What to forget, in the words they used for it.' },
        scope: {
          type: 'string',
          enum: ['about-them', 'skill', 'lesson'],
          description:
            "What kind of thing it is. 'about-them' is anything you know about the person, which is the usual case. 'skill' is one of the ways of doing things they taught you. 'lesson' is something you wrote down about your own work.",
        },
      },
      required: ['about'],
    },
  },
  {
    name: 'app_standby',
    description:
      'Go quiet and wait. Call this the moment the user asks you to hold on, wait, stand by, or stop for now. After calling it, say nothing at all until you hear the wake phrase.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'app_resume',
    description:
      'Come back from waiting. Call this when you hear the wake phrase after standing by, then greet the user in a few words and pick the conversation up where it stopped.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

export { buildPersonaInstructions, PERSONA_PRESET_IDS, type PersonaPresetId, type SpokenVoice } from './personas';
export { LOCAL_S2S_ENDPOINT };
export * from './types';
