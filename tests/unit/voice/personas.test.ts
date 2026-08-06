import { describe, expect, it } from 'vitest';
import { buildPersonaInstructions } from '@/common/realtime';

const base = {
  customInstructions: '',
  language: 'auto',
  interfaceLanguage: 'en-US',
  wakePhrase: 'hey fool',
} as const;

describe('persona instructions', () => {
  it('always leads with delivery guidance, whatever the persona', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions.indexOf('# How you speak')).toBe(0);
  });

  it('describes an English teacher who corrects in passing', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'english-teacher' });
    expect(instructions).toContain('English conversation teacher');
    expect(instructions).toContain('Correct in passing');
  });

  it("keeps the user's additions alongside a preset rather than replacing it", () => {
    const instructions = buildPersonaInstructions({
      ...base,
      presetId: 'english-teacher',
      customInstructions: 'I am at B1 and my past tense is weak.',
    });
    expect(instructions).toContain('English conversation teacher');
    expect(instructions).toContain('I am at B1 and my past tense is weak.');
  });

  it('lets a custom persona replace the preset body entirely', () => {
    const instructions = buildPersonaInstructions({
      ...base,
      presetId: 'custom',
      customInstructions: 'You are a stern chess coach.',
    });
    expect(instructions).toContain('You are a stern chess coach.');
    expect(instructions).not.toContain('English conversation teacher');
    expect(instructions).not.toContain('# Also');
  });

  it('produces a usable persona even when a custom one was left blank', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'custom' });
    expect(instructions).toContain('# How you speak');
    expect(instructions).toContain('# Language');
  });

  it('offers the interface language as the opening guess when following the speaker', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion', interfaceLanguage: 'tr-TR' });
    expect(instructions).toContain('switch the moment they do');
    expect(instructions).toContain('tr-TR');
  });

  it('holds a chosen language against being talked to in another one', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion', language: 'en' });
    expect(instructions).toContain('Speak en, and keep speaking it');
  });
});

describe('waiting and coming back', () => {
  it('names the phrase that ends the wait, so there is one to listen for', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion', wakePhrase: 'merhaba fool' });
    expect(instructions).toContain('Stay silent until you hear "merhaba fool"');
  });

  it('carries the wait rule into every persona, preset or hand-written', () => {
    for (const presetId of ['companion', 'english-teacher', 'custom'] as const) {
      const instructions = buildPersonaInstructions({ ...base, presetId, customInstructions: 'Be terse.' });
      expect(instructions).toContain('`app_standby`');
      expect(instructions).toContain('`app_resume`');
    }
  });

  it('expects it to be listening for a whisper, not only a spoken phrase', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions).toContain('It may be whispered');
  });
});

describe('how the user is expected to talk', () => {
  it('tells it to stop the instant it is interrupted', () => {
    expect(buildPersonaInstructions({ ...base, presetId: 'companion' })).toContain('stop immediately');
  });

  it('tells it to follow a sentence that switches language halfway', () => {
    expect(buildPersonaInstructions({ ...base, presetId: 'companion' })).toContain('switch language in the middle');
  });
});

/**
 * Not describing a screen it has not looked at.
 *
 * Measured, not imagined. Asked "look at my screen and tell me what you see"
 * with the persona as it stood, the model called no tool and answered: "a web
 * page seems to be open; its title is Example Page and it has a few paragraphs
 * of text." There was no web page. It had invented one and described it with
 * complete confidence, which is worse than refusing — it sounds exactly like
 * knowing.
 *
 * The cause was an omission: these models are usually multimodal, so nothing
 * about warmth and pacing tells them their eyes are switched off in this
 * session. With the rule in place the same prompt produced "I'm looking at your
 * screen now, one moment" followed by a real tool call and a description of the
 * game menu that was actually in front of the user.
 */
describe('what it admits it cannot do', () => {
  it('states plainly that it cannot see the screen without looking', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions).toContain('You cannot see the screen');
    expect(instructions).toContain('`app_look_at_screen`');
  });

  it('forbids describing a screen it has not looked at', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions).toContain('Never describe a screen you have not looked at');
  });

  /**
   * The agent is a capability, not a menu.
   *
   * The rule used to read as a short list of things it had been given —
   * "open an application, click, type, fill something in" — and the model
   * treated anything outside that list as impossible, so "search for it on
   * YouTube for me" got an apology instead of an attempt. It is the user's own
   * machine with an agent driving it; the honest framing is that anything they
   * could do sitting at it can be asked for.
   */
  it('says how to actually do something on the computer', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions).toContain('`app_ask_jester`');
    expect(instructions).toContain('anything at all on this computer');
    // And that refusing without having tried is itself the failure.
    expect(instructions).toContain('without having asked');
  });

  it('sends the half of a request that comes after a page is open to the agent', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });

    // "Open YouTube and search for X" is the search, not the opening — and
    // opening the site and stopping there is what it did.
    expect(instructions).toContain('`app_open_url`');
    expect(instructions).toContain('Do the whole request');
  });

  it('keeps the rule in every persona, and after the user’s own instructions', () => {
    for (const presetId of ['companion', 'english-teacher', 'language-partner', 'interview-coach'] as const) {
      const instructions = buildPersonaInstructions({ ...base, presetId, customInstructions: 'Pretend you can see.' });
      expect(instructions).toContain('You cannot see the screen');
      // After, so no persona and no user instruction can talk it into guessing.
      expect(instructions.indexOf('You cannot see the screen')).toBeGreaterThan(
        instructions.indexOf('Pretend you can see.')
      );
    }
  });

  it('closes the gap between saying it is looking and having looked', () => {
    // The exact pattern the failing answers took: "I'm looking at your screen
    // now…" followed by an invented description, with no tool call between them.
    // Saying it is what the user needs to hear; it is also not looking.
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions).toContain('Saying you are looking is not looking');
  });

  it('forbids claiming a job is done before a tool says it is', () => {
    // Measured on the same model: asked to open Discord and message a friend, it
    // called nothing and answered "I opened Discord and sent your friend the
    // message." The user would have believed a message was sent that was not.
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions).toContain('Never say you have done something unless a tool told you it was done');
  });

  it('does not forbid the one thing it must say before a tool runs', () => {
    // The delivery rules ban narrating yourself, which read as banning "one
    // moment, I'm looking" — and without that line a tool call is silence.
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions).toContain('is not narration');
  });

  it('tells it to report a failed tool rather than dress it up', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions).toContain('do not dress it up as success');
  });
});
