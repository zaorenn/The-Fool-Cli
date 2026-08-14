/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildMcpSpawnCommand,
  resolveBridgeToken,
  resolveBrowserUrl,
} from '@/process/resources/builtinMcp/browserServerPort';

describe('resolveBrowserUrl', () => {
  it('builds the URL from the port inherited down the process tree', () => {
    expect(resolveBrowserUrl({ env: { AIONUI_CDP_ACTIVE_PORT: '9230' } })).toBe('http://127.0.0.1:9230');
  });

  it('pins the host to loopback so the agent can never be aimed at a remote debugger', () => {
    expect(resolveBrowserUrl({ env: { AIONUI_CDP_ACTIVE_PORT: '9230' } })).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it('rejects malformed or out-of-range ports', () => {
    for (const port of ['0', '-1', 'abc', '70000', '9230.5', '']) {
      expect(resolveBrowserUrl({ env: { AIONUI_CDP_ACTIVE_PORT: port } })).toBeNull();
    }
  });

  it('refuses to start when no port was inherited', () => {
    // µï┐õ©ıÕê░½»ÕÅúÕÅ¬µ£ëõ©ñğıµâàÕåÁ´╝Üö¿µêÀÕà│µÄëõ║å CDP´╝îµêûõ©ıµİ»õ╗ÄÕ║öö¿ÚçîÕÉ»Õè¿ÜäÒÇé
    // õ©ñğıÚâ¢Õ┐àÚí╗Õñ▒×┤Ñ´╝îõ©ı×â¢ÕÄ╗î£ ÔÇöÔÇö î£ÚöÖõ╝Üµèè Agent ×┐ŞÕê░ÕÅĞõ©Çõ©¬Õ«Şõ¥ïÜäµÁÅ×ğêÕÖ¿õ©èÒÇé
    //
    // No inherited port means either the user disabled CDP or this was not launched
    // by the app. Both must fail rather than guess: guessing wrong would connect the
    // agent to a *different* instance's browser.
    expect(resolveBrowserUrl({ env: {} })).toBeNull();
  });

  it('ignores the user-facing AIONUI_CDP_PORT so a disabled setting cannot be re-enabled by inheritance', () => {
    // AIONUI_CDP_PORT µİ»ÒÇîö¿µêÀ×¥ôÕàÑÒÇı,õ╝İÕàê║ğÚ½İõ║ÄÚàı¢«µûçõ╗ÂÒÇéÕĞéµŞ£×┐ÖÚçîõ╣ş×»╗Õ«â,
    // ö¿µêÀÕà│µÄë CDP ÕÉÄé╣Õ║öö¿ÕåàÚçıÕÉ»,╗ğµë┐µØÑÜäÕÇ╝õ╝Ü×ó½Õ¢ôµêÉÒÇîö¿µêÀ×Ğüµ▒éÕ╝ÇÕÉ»ÒÇı,
    // µèèÕêÜõ┐ØÕ¡İÜä×«¥¢«µéäµéä×ĞåøûµÄëÒÇéõ©ñõ©¬ö¿ÚÇöÕ┐àÚí╗ÕêåÕ╝ÇÒÇé
    //
    // AIONUI_CDP_PORT is user input that outranks the config file. Reading it here
    // too would mean a disabled setting gets silently re-enabled after an in-app
    // restart, because the relaunched process inherits the value.
    expect(resolveBrowserUrl({ env: { AIONUI_CDP_PORT: '9230' } })).toBeNull();
  });
});

describe('resolveBridgeToken', () => {
  it('returns the token inherited from the process tree', () => {
    expect(resolveBridgeToken({ env: { AIONUI_CDP_BRIDGE_TOKEN: 'abc123' } })).toBe('abc123');
  });

  it('returns null when absent, so the caller refuses to start rather than connecting unauthenticated', () => {
    expect(resolveBridgeToken({ env: {} })).toBeNull();
  });

  it('treats a whitespace-only token as absent', () => {
    expect(resolveBridgeToken({ env: { AIONUI_CDP_BRIDGE_TOKEN: '   ' } })).toBeNull();
  });

  it('trims surrounding whitespace picked up from env plumbing', () => {
    expect(resolveBridgeToken({ env: { AIONUI_CDP_BRIDGE_TOKEN: ' tok \n' } })).toBe('tok');
  });
});

/**
 * ÕøŞÕ¢ÆµÁï×»ò´╝Üissue #3883 ÔÇöÔÇö Windows õ©è aionui-browser MCP Õ«îÕà¿×ÁÀõ©ıµØÑÒÇé
 *
 * npx Õ£¿ Windows õ©èµİ» npx.cmd´╝îµë╣ÕñäÉåµûçõ╗Âµ▓íµ£ë╗ê½»µùáµ│ò×ç¬ÕÀ▒µëğ×íî´╝îø┤µÄÑ spawn õ╝Üµèø EINVAL
 * ´╝êCVE-2024-27980 õ╣ïÕÉÄ Node µöÂ┤ğõ║å .cmd ÕñäÉå´╝ëÒÇéµùğõ╗úáüÕÅ¬µİ»µèèÕÅ»µëğ×íîÕÉıµıóµêÉ 'npx.cmd'´╝î
 * ×Çîµ│¿Úçèµ£¼×║½Õ░▒ÕåÖµİÄÒÇîõ©ı×Á░ shell õ╝ÜÕñ▒×┤ÑÒÇıÔÇöÔÇö µıóÕÉıµü░µü░Õ░▒µİ»Úéúõ©¬Õñ▒×┤ÑÕåÖµ│òÒÇé
 *
 * ×┐ÖµØíÕêåµö»µ¡ñÕëıµ▓íµ£ëõ╗╗õ¢òµÁï×»ò×Ğåøû´╝êspawn Õ£¿µ¿íÕØùÚíÂÕ▒é´╝îÕıòµÁï import õ©ıõ║å browserServer.ts´╝ë´╝î
 * µëÇõ╗Ñ╝║ÚÖÀÕ¥ùõ╗ÑÕÉêÕ╣Â×┐øõ©╗Õ╣▓ÒÇéÄ░Õ£¿Õæ¢õ╗ñ×íîÜä╗ä×úà×ó½µè¢µêÉ║»Õç¢µò░´╝î×â¢ø┤µÄÑÚÆëõ¢ÅÒÇé
 *
 * Regression test for issue #3883: the aionui-browser MCP never starts on Windows. npx is
 * npx.cmd there, a batch file that cannot execute without a terminal, so spawning it directly
 * throws EINVAL (Node tightened .cmd handling after CVE-2024-27980). The old code merely
 * renamed the executable to 'npx.cmd' while its own comment said spawning without a shell
 * fails ÔÇö the rename *is* the failing form.
 *
 * This branch had no test coverage (spawn runs at module scope, so browserServer.ts cannot be
 * imported by a unit test), which is how the defect reached main. The command assembly is now a
 * pure function and can be pinned directly.
 */
describe('buildMcpSpawnCommand ÔÇö issue #3883', () => {
  const version = '0.16.0';
  const browserUrl = 'http://127.0.0.1:61622';

  it('never spawns npx.cmd directly on Windows (that is the EINVAL form)', () => {
    const { command } = buildMcpSpawnCommand({ platform: 'win32', version, browserUrl });
    expect(command).not.toBe('npx.cmd');
    expect(command).toBe('cmd.exe');
  });

  it('routes through cmd.exe /c on Windows with npx as an argument', () => {
    const { command, args } = buildMcpSpawnCommand({ platform: 'win32', version, browserUrl });
    expect(command).toBe('cmd.exe');
    expect(args.slice(0, 2)).toEqual(['/c', 'npx']);
    expect(args).toContain(`chrome-devtools-mcp@${version}`);
  });

  it('passes --browser-url as its own argv entry, never concatenated into one string', () => {
    /**
     * ÕêåµêÉõ©ñõ©¬ argv µØíø«µİ»Õê╗µäÅÜä´╝Üshell: true ÜäÕåÖµ│òõ╝Üµèèµò┤µØíÕæ¢õ╗ñµï╝µêÉÕ¡ù¼Ğõ©▓Õåıõ║ñ╗Ö
     * cmd.exe ×ğúµŞÉ´╝îÚéúµùÂ browserUrl ÚçîÜä `&` `|` `^` Úâ¢õ╝ÜÕÅİµêÉÕàâÕ¡ù¼ĞÒÇéõ┐Øµîüµò░╗äÕ¢óÕ╝Å
     * µëı×â¢×«®µ»Åõ©¬ÕÅéµò░ÕÉä×ç¬õ┐ØòÖ×¢¼õ╣ë×»¡õ╣ëÒÇé
     *
     * Keeping these as separate argv entries is deliberate: the shell: true form concatenates
     * the whole command into one string for cmd.exe to parse, at which point `&`, `|` and `^`
     * inside browserUrl become metacharacters. The array form keeps each argument escaped.
     */
    for (const platform of ['win32', 'darwin', 'linux']) {
      const { args } = buildMcpSpawnCommand({ platform, version, browserUrl });
      const flagIndex = args.indexOf('--browser-url');
      expect(flagIndex).toBeGreaterThanOrEqual(0);
      expect(args[flagIndex + 1]).toBe(browserUrl);
      expect(args.some((a) => a.includes(`--browser-url=`))).toBe(false);
    }
  });

  it('keeps the plain npx invocation on POSIX platforms', () => {
    for (const platform of ['darwin', 'linux']) {
      const { command, args } = buildMcpSpawnCommand({ platform, version, browserUrl });
      expect(command).toBe('npx');
      expect(args[0]).toBe('-y');
      expect(args).not.toContain('/c');
    }
  });

  it('pins the MCP version rather than resolving @latest at launch', () => {
    /**
     * @latest µ»Åµ¼íÚĞûÕÉ»Úâ¢×Ğü×üö¢æ×ğúµŞÉ´╝êĞ╗║┐ø┤µÄÑÕñ▒×┤Ñ´╝ë´╝îõ╣şµäÅÕæ│ØÇõ©èµ©©ÕÅ»õ╗ÑÚÜÅµùÂµıóµÄëÚ®▒Õè¿µÁÅ×ğêÕÖ¿
     * Üäõ╗úáü ÔÇöÔÇö ×ÇîÚéúõ©¬µÁÅ×ğêÕÖ¿Úçîµ£ëö¿µêÀÜäÖ╗Õ¢òµÇüÒÇé
     *
     * @latest re-resolves over the network on first launch (hard failure offline) and lets an
     * uncontrolled upstream swap out the code driving a browser that holds the user's live
     * sign-in cookies.
     */
    const { args } = buildMcpSpawnCommand({ platform: 'win32', version, browserUrl });
    expect(args).not.toContain('chrome-devtools-mcp@latest');
    expect(args).toContain(`chrome-devtools-mcp@${version}`);
  });
});
