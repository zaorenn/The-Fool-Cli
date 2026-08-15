/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { documentFileName, documentFormat, flattenSpans, parseMarkdown, parseSpans } from '@process/pdf/documentModel';

/**
 * What a document is, between "write me a report" and a file on disk.
 *
 * The half worth testing: everything downstream is a library call, and every
 * way a document can come out wrong that is *our* fault happens here — a
 * heading read as a paragraph, a table whose columns do not line up, a list
 * that numbers itself 1, 1, 1 in a file somebody is about to send.
 */

describe('parseSpans', () => {
  it('reads the three kinds of emphasis that actually appear', () => {
    expect(parseSpans('plain **bold** and *italic* and `code`')).toEqual([
      { text: 'plain ' },
      { text: 'bold', bold: true },
      { text: ' and ' },
      { text: 'italic', italic: true },
      { text: ' and ' },
      { text: 'code', code: true },
    ]);
  });

  /** A backtick span holding an asterisk is a filename, not emphasis. */
  it('does not look for emphasis inside code', () => {
    expect(parseSpans('run `ls *.ts` now')).toEqual([
      { text: 'run ' },
      { text: 'ls *.ts', code: true },
      { text: ' now' },
    ]);
  });

  it('always produces something, so a writer iterating spans cannot lose the line', () => {
    expect(parseSpans('')).toEqual([{ text: '' }]);
    expect(flattenSpans(parseSpans('a **b** c'))).toBe('a b c');
  });
});

describe('parseMarkdown', () => {
  it('takes the first level-one heading as what the file is called', () => {
    expect(parseMarkdown('# Quarterly Report\n\nSome prose.').title).toBe('Quarterly Report');
  });

  it('joins the lines of a paragraph and breaks on a blank one', () => {
    const { blocks } = parseMarkdown('one\ntwo\n\nthree');

    expect(blocks).toEqual([
      { kind: 'paragraph', spans: [{ text: 'one two' }] },
      { kind: 'paragraph', spans: [{ text: 'three' }] },
    ]);
  });

  /**
   * Models write `1.` for every item as often as they count. A list that reads
   * 1, 1, 1 in a document somebody sends is an error they get blamed for.
   */
  it('numbers an ordered list itself rather than trusting the source', () => {
    const { blocks } = parseMarkdown('1. first\n1. second\n1. third');

    expect(blocks.map((block) => (block.kind === 'listItem' ? block.index : null))).toEqual([1, 2, 3]);
  });

  it('starts the numbering again after the list ends', () => {
    const { blocks } = parseMarkdown('1. a\n1. b\n\nprose\n\n1. c');
    const numbers = blocks.flatMap((block) => (block.kind === 'listItem' ? [block.index] : []));

    expect(numbers).toEqual([1, 2, 1]);
  });

  it('reads a table with its header and rows', () => {
    const { blocks } = parseMarkdown('| Name | Age |\n| --- | --- |\n| Ada | 36 |\n| Grace | 45 |');

    expect(blocks).toEqual([
      {
        kind: 'table',
        header: ['Name', 'Age'],
        rows: [
          ['Ada', '36'],
          ['Grace', '45'],
        ],
      },
    ]);
  });

  /** Without the divider check, a sentence containing pipes becomes a table. */
  it('does not read prose with pipes in it as a table', () => {
    const { blocks } = parseMarkdown('| this is just | a sentence |');

    expect(blocks[0].kind).toBe('paragraph');
  });

  /**
   * A heading mark inside a shell script is a comment. Reading it as a heading
   * is how a document ends up with a section called `# install dependencies`.
   */
  it('does not parse anything inside a fenced block', () => {
    const { blocks } = parseMarkdown('```bash\n# install\nls -la | wc\n```');

    expect(blocks).toEqual([{ kind: 'code', text: '# install\nls -la | wc', language: 'bash' }]);
  });

  it('closes an unterminated fence at the end of the document', () => {
    const { blocks } = parseMarkdown('```\nstill code');

    expect(blocks).toEqual([{ kind: 'code', text: 'still code', language: '' }]);
  });

  it('caps heading depth, because past three there is nothing left to distinguish', () => {
    const { blocks } = parseMarkdown('###### deep');

    expect(blocks).toEqual([{ kind: 'heading', level: 3, spans: [{ text: 'deep' }] }]);
  });

  it('keeps every line, whatever it is', () => {
    const source = '# T\n\npara\n\n- a\n- b\n\n> quoted\n\n---\n\n1. one';
    const { blocks } = parseMarkdown(source);

    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'listItem',
      'listItem',
      'paragraph',
      'rule',
      'listItem',
    ]);
  });
});

describe('documentFormat', () => {
  it('takes the words a person says for each format', () => {
    expect(documentFormat('pdf')).toBe('pdf');
    expect(documentFormat('Word')).toBe('docx');
    expect(documentFormat('.DOC')).toBe('docx');
    expect(documentFormat('excel')).toBe('xlsx');
    expect(documentFormat('sheet')).toBe('xlsx');
  });

  it('answers with nothing for a format it cannot write', () => {
    expect(documentFormat('pptx')).toBeNull();
    expect(documentFormat('')).toBeNull();
  });
});

describe('documentFileName', () => {
  it('names the file after the document', () => {
    expect(documentFileName('Quarterly Report', 'pdf', 'Document')).toBe('Quarterly Report.pdf');
  });

  /**
   * A model that could name the file could otherwise name the directory. Every
   * separator and every character Windows reserves is removed rather than
   * replaced with something clever.
   */
  it('cannot be talked into a path', () => {
    expect(documentFileName('../../etc/passwd', 'pdf', 'Document')).toBe('.. .. etc passwd.pdf');
    expect(documentFileName('C:\\Windows\\System32\\x', 'docx', 'Document')).toBe('C Windows System32 x.docx');
    expect(documentFileName('a<b>c:d"e|f?g*h', 'xlsx', 'Document')).toBe('a b c d e f g h.xlsx');
  });

  it('falls back when the document never named itself', () => {
    expect(documentFileName('', 'pdf', 'Document')).toBe('Document.pdf');
    expect(documentFileName('   ', 'pdf', 'Report')).toBe('Report.pdf');
  });

  it('does not leave a trailing dot or space, which Windows refuses', () => {
    expect(documentFileName('Report.', 'pdf', 'Document')).toBe('Report.pdf');
    expect(documentFileName('Report ', 'pdf', 'Document')).toBe('Report.pdf');
  });
});
