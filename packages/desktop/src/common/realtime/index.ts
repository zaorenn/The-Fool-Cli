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
      "Change how the app looks: its colour ('palette'), what it is made of ('style'), and how it moves ('dial'). 'Soften the shadows', 'calm it down', 'rounder corners' are dials nudged with 'more' or 'less'.",
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['palette', 'style', 'dial', 'reset'],
          description:
            "'palette' changes the colour, 'style' changes what the app is made of, 'dial' moves one aspect of it, 'reset' returns to the app's own.",
        },
        palette: {
          type: 'string',
          enum: ['ember', 'amber', 'wheat', 'moss', 'lagoon', 'indigo', 'orchid', 'rose', 'slate'],
          description:
            "For 'palette'. ember is red, amber orange, wheat yellow, moss green, lagoon teal, indigo blue, orchid purple, rose pink, slate grey. Pick the nearest one to what they described; a colour word on its own works too.",
        },
        color: {
          type: 'string',
          description:
            "For 'palette', when they named an exact colour such as #1f6f8b. It is matched to the nearest palette above rather than used as given, because only those nine are checked for readability.",
        },
        material: {
          type: 'string',
          enum: ['neu', 'glass', 'liquid', 'clay', 'aurora', 'brutal', 'minimal'],
          description:
            "For 'style'. neu is raised, glass is a lit pane, liquid bends, clay is thick and soft, aurora is dark and moving, brutal is hard-shadowed, minimal is a line.",
        },
        dial: {
          type: 'string',
          enum: [
            'radius',
            'depth',
            'blur',
            'alpha',
            'sheen',
            'lift',
            'press',
            'ambient',
            'gap',
            'weight',
            'leading',
            'tracking',
            'edge',
            'spread',
            'inner',
            'saturation',
            'bounce',
            'tint',
          ],
          description:
            "For 'dial'. radius is corner roundness, depth is shadow, alpha is transparency, lift is hover rise, ambient is background movement, gap is spacing, weight is heading thickness.",
        },
        direction: {
          type: 'string',
          enum: ['more', 'less'],
          description: 'Which way to move the dial. Use this rather than a number unless they named one.',
        },
        amount: { type: 'number', description: 'An exact value for the dial, when the user named one.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'app_look_at_screen',
    description:
      "Look at what is on the user's screen right now and get it back described in words. Call this whenever the user says to look at their screen, or asks about a page, a window, an error or anything they can see and you cannot — including 'summarise this page'. Call it first and speak afterwards: announcing the look before making it is a second or two of the user waiting for a sentence that does nothing, and if you then say what is there before the result arrives you are describing a screen you have not seen. Tell them what is there in your own words once it comes back.",
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'What to look for, in a sentence. Leave out for a plain summary of the screen.',
        },
        window: {
          type: 'string',
          description:
            "The application whose window to look at — 'Spotify', 'Chrome', 'Visual Studio Code'. Give it whenever the question is about one program, which is nearly always: a picture of one window is the answer to what was asked, where a picture of the whole desktop is four things it might be about and more of the user's private screen than the question needed. Leave it out only when they genuinely mean the whole screen. A name that matches no open window comes back saying so — say that, and do not describe a screen you were not shown.",
        },
      },
      required: [],
    },
  },
  {
    name: 'app_open_url',
    description:
      "Open one or more web pages in the user's own default browser, each in a new tab of the browser they already have open. Pass every address you want open in a single call — 'open each of those in my browser' is one call with the whole list, not one call per page. Use this only when getting the addresses open is the whole request. Playing something is app_play, which does it in the background; searching inside a site is app_search; anything else that has to happen after a page loads is app_ask_jester's job. Open them first and then say how many you opened and what they are, in a few words; do not read the addresses out.",
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
    name: 'app_play',
    description:
      "Play a song, an album or a video, in the background. This is the whole of 'put my favourite song on', 'play Bunny Girl', 'put some music on' — one call, nothing to click, and the user keeps their screen and their pointer. When they have connected a music service it plays there, on the device their music already comes from, and comes back with the track and the speaker so you can say what is on; otherwise it opens the thing in their own default browser and comes back saying that it opened it and nothing more. Never drive the screen to play something and never hand playing to app_ask_jester: clicking a play button through a browser takes minutes, hijacks their cursor and cannot tell you whether any sound came out. Call it first and say what happened after — and say exactly what the result says. If it comes back with `playing` false, it opened a page and you do not know whether anything is playing, so do not say that it is.",
    parameters: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          description: "What to play, in the user's own words — a song title, an artist, a video name.",
        },
        url: {
          type: 'string',
          description:
            'A real address for it, when you already have one from app_find_video or from the user. Never one you assembled from a title: an address built out of a name does not exist.',
        },
      },
      required: ['what'],
    },
  },
  {
    name: 'app_connect',
    description:
      "Connect one of the user's own accounts, so the assistant can act in it. Right now that is Spotify, which is what makes 'play my favourite song' happen in the background on their own speakers instead of as a page opening. Three rules, and they are absolute. **Ask first** — never call this because it would be useful; call it only after they have said yes to a plain question like 'would you like to connect Spotify?'. **They sign in, not you** — this opens the service's own page in their own browser, and from that moment it is theirs: never type into it, never fill a login form, never look at that window, and never drive it with clicks. **Never ask for a password, a code or a token in this conversation, and refuse if they offer one.** Say in a few words that their browser is open and that you will wait; when it comes back, say whether it worked.",
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string', enum: ['spotify'], description: 'Which account to connect.' },
        confirmed: {
          type: 'boolean',
          description:
            'True only when they have actually said yes to being asked. Without it this does nothing but tell you to ask, because opening a sign-in nobody agreed to is a browser window appearing for no reason they can see.',
        },
      },
      required: ['service'],
    },
  },
  {
    name: 'app_open_app',
    description:
      "Open or close an application on the user's computer, through the operating system. 'Open Spotify', 'close Discord', 'quit Steam' — one call, instantly, with no window driven and no pointer taken. Use this rather than app_ask_jester for anything that is only starting or stopping a program: the agent would do it by finding the icon and clicking it, which takes minutes of the user's own screen. Give the application's ordinary name, as they said it. Closing asks the application to quit, so anything unsaved is still theirs to answer.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The application's name, as a person says it. 'Spotify', 'Notepad'." },
        action: {
          type: 'string',
          enum: ['open', 'close'],
          description: "'open' starts it, 'close' asks it to quit. Defaults to opening.",
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'app_fill_pdf',
    description:
      "Fill in a PDF form. 'Fill this in', 'complete that form', 'put my details in this PDF' — start it the moment you are asked, before saying anything: this writes the file directly and takes seconds, so an announcement first is a delay for no reason. Do NOT use app_ask_jester for a PDF form; that one opens a viewer and types with the user's own pointer, which is minutes of their screen for something this does without a window. Pass any values you genuinely already know from the conversation or the user's memory. Do not ask them here for the ones you do not know and do not guess them — this tool stops and asks the user itself for every required field still empty, waits for the answer, and then carries on, so asking first would put the same question twice. The original document is never changed; a filled copy is written beside it. When it returns, say where the copy went and name anything it reports as still unfilled — never call a form complete while that list has something in it.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The full path of the PDF file to fill in.' },
        values: {
          type: 'array',
          description:
            'Only what you already know. Leave it out entirely if you know nothing — the missing fields are asked about for you.',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                description: "The field, by the name the form uses or in ordinary words such as 'surname'.",
              },
              value: { type: 'string', description: 'What to put in it.' },
            },
            required: ['field', 'value'],
          },
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'app_search',
    description:
      "Search inside a site and put the results in front of the user, in one step. This is the whole of 'open YouTube and find that song', 'search GitHub for it', 'look it up on Wikipedia' — it goes straight to the site's own results page, so it happens instantly instead of taking the agent minutes of clicking. Use it for every request that ends in a search on a named site, and for a plain web search when no site was named. Search first and then say what you looked for and where, in a few words; do not read the address out. Playing one of the results is app_play, not a search followed by clicking; buying or replying is app_ask_jester.",
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
      "Do anything at all on this computer, through an agent that drives it. Opening and using applications, clicking, typing, searching inside a page that is already open, filling in forms, sending a message in Discord or an email, files, code, research. This is not a fixed list: it is the user's own machine, so anything they could do sitting at it can be asked for in a sentence. Use it for every request that changes something outside this conversation, including the second half of a request whose first half was opening a page. Call it before you say anything about it — it runs while you keep talking, so start it and then say briefly that you are on it, rather than announcing it and starting it a sentence later. Report the outcome when it comes back. Do not use it to look at the screen, to play something, or to open or close an application: those are app_look_at_screen, app_play and app_open_app, and each of them is instant where this is minutes of driving the user's own desktop.",
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
      'Change how the assistant itself behaves: voice, speech speed and volume, reply language, persona, hold-to-talk, unattended running, interrupt word, wake phrase, models, layout, workspace. For colours use app_theme; for anything outside this app use app_ask_jester.',
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
            'workspace',
          ],
          description: 'Which one to change.',
        },
        value: {
          type: 'string',
          description:
            "The new value. 'voice': an id from the installed voices you were given. 'speed'/'volume': a number, 1 is normal. 'reply_language': a code such as en or tr, or 'auto'. 'persona': companion, english-teacher, language-partner, interview-coach. 'layout': instrument/hud (voice page), column/transcript (chat), gallery/index (Hub), standard/focused (app frame), or one the user saved. 'workspace': a workspace name, 'default' ships. On/off settings: 'on' or 'off'.",
        },
      },
      required: ['setting', 'value'],
    },
  },
  {
    name: 'app_remember',
    description:
      "Keep something about the person, so it is still true in tomorrow's conversation: what to call them, what they are working on, how they like things done, what machine they are on — anything you would be embarrassed to ask twice. Also use it when something you already knew has changed.",
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
            "What that word stands for, exactly enough to act on: a full folder path, a person's full name, the address of a site. Take it from what they actually said — never from an example, and never a path with somebody else's name in it.",
        },
      },
      required: [],
    },
  },
  {
    name: 'app_learn',
    description:
      'Get better at working for this person, so they never say the same thing twice. Use `lesson` the moment they correct you or something you did was wrong. Use `skillName` with `skillSteps` when they are teaching you how they want something done. Both are read back at the start of every future conversation, so write them as instructions to yourself rather than as notes about what happened.',
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
    name: 'app_rule',
    description:
      "Take a standing instruction about how to behave, as opposed to a fact about them: 'answer in English even when I speak Turkish', 'always ask before you run anything'. app_remember keeps what is true about them; this keeps what they told you to do, and you must then do it every turn until they say otherwise. Set `remember` only when they asked for it to last beyond this conversation.",
    parameters: {
      type: 'object',
      properties: {
        rule: {
          type: 'string',
          description:
            'The instruction, written as something to do rather than as a report of what they said. "Answer in English, whatever language I am speaking."',
        },
        remember: {
          type: 'boolean',
          description:
            'True only when they asked for it to be kept beyond this conversation. When in doubt leave it false: a rule that turns out to be permanent is one sentence away, and one that was never meant to be is something they have to discover and undo.',
        },
        stop: {
          type: 'string',
          description:
            'Name a rule to withdraw instead of setting one — enough of it to be unambiguous. "answering in English". Use it when they say to stop, to forget it, or that the opposite is now true.',
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
    name: 'app_skill',
    description:
      "Turn something the user taught you into a real, installed skill every agent can use. If they can explain it, use `write`. If it involves a screen — 'let me show you' — use `record` first, then `write` when they say they are done. For a rule you simply follow yourself, `app_learn` is enough.",
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['record', 'write', 'cancel'],
          description:
            "'record' starts watching their screen so a demonstration is captured, 'write' finishes and installs the skill — stopping any recording first — and 'cancel' throws a recording away without keeping anything.",
        },
        name: { type: 'string', description: 'What they call it, in their words. "Send an invoice".' },
        what: {
          type: 'string',
          description:
            'What it is for, in one sentence, written as when to reach for it: "When the user asks to send an invoice to a client." This is the only thing that decides whether the skill is ever used, so it matters more than the name.',
        },
        steps: {
          type: 'string',
          description: 'How they do it, in order, in their own words. Keep what they said rather than improving on it.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'app_skill_teach',
    description:
      'Learn to do one thing yourself, so that next time you simply do it instead of handing it to the agent. Use it whenever they show you or tell you something they will want again: a song they call their favourite, an application they want opened by a name of their own, a page they keep going back to. This tool saves; it does not find. Hold the address or the path already when you call it, because a skill saved without the right target fails silently later, long after anyone is watching. If you do not have one, do not call this yet: for anything on the web call app_find_video with the title, tell them which result you found and wait for them to agree, then call this with that address. Say in a few words that you have it and what to say to use it.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What to call it, short. "Favourite song".' },
        when: {
          type: 'string',
          description: 'When to use it, in their words. "When I ask for my favourite song."',
        },
        url: {
          type: 'string',
          description:
            'The full web address to open, when the skill is a page. Must be the real address, read from the screen or given by them — never one you assembled from the title.',
        },
        path: {
          type: 'string',
          description:
            'The full path of the program or file to open, when the skill is something on their machine. A path only: never a command, never anything after the path.',
        },
      },
      required: ['name', 'when'],
    },
  },
  {
    name: 'app_find_video',
    description:
      'Find the real address of a video or song from its name, without opening anything. Use it whenever you can see or have been told what something is but not where it is — which is almost always, because their address bar is usually behind this window. Looking at the screen gives you a title, not an address, and an address you assemble from a title does not exist. Comes back with the first result and its own title. Say what you found and ask whether that is the one before you save it as a skill or open it; if nothing comes back, say so and ask them for the address.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The name to search for — the title as they said it, or as you read it off the screen.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'app_skill_do',
    description:
      'Do one of the things they taught you, by name. Instant and local — no agent, nothing to wait for. Use it the moment a request matches one of the skills listed for you, in preference to app_ask_jester or app_open_url. Say what you are doing in a few words, and never read the address out.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill, as they refer to it. "my favourite song".' },
        forget: {
          type: 'boolean',
          description: 'Drop the skill instead of doing it, when they say to forget how to do something.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'app_workspace',
    description:
      'Build the user a small app of their own, and move them into it. Use this when they describe a thing they want rather than a task they want done — "make me something that turns a YouTube link into guitar tab", "I want a panel that watches my builds", "build me a place to draft posts". It writes a real page, gives it the agent as its back end, keeps it in a workspace under a name, and switches to it, so it is there tomorrow and can be sent to somebody. It runs for a few minutes while you keep talking, so say briefly that you are on it and tell them what it does when it comes back. Use \'use\' to move them into one they already have. For a one-off thing to look at rather than keep, app_build_app is lighter.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['build', 'use'],
          description: "'build' makes a new one, 'use' switches to one they already have.",
        },
        name: { type: 'string', description: 'What to call it, in their words. "Guitar tab".' },
        wanted: {
          type: 'string',
          description:
            'What it should do, in their own words and in as much detail as they gave — what goes in, what comes out, what it should show. This is the whole brief, so do not shorten it.',
        },
      },
      required: ['action', 'name'],
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

export {
  buildPersonaInstructions,
  findPersonaByName,
  forgetPersona,
  MAX_SAVED_PERSONAS,
  PERSONA_INSTRUCTIONS_MAX,
  PERSONA_NAME_MAX,
  PERSONA_PRESET_IDS,
  rememberPersona,
  sanitizeSavedPersonas,
  VOICE_PERSONAS_CONFIG_KEY,
  type PersonaPresetId,
  type SavedPersona,
  type SpokenVoice,
} from './personas';
export { LOCAL_S2S_ENDPOINT };
export * from './types';
