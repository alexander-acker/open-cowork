import { describe, it, expect } from 'vitest';
import { splitTextByFileMentions, getFileLinkButtonClassName, splitChildrenByFileMentions } from '../src/renderer/utils/file-link';

describe('splitTextByFileMentions', () => {
  it('detects bare filenames with extension', () => {
    const input = ' .txt ';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: ' ' },
      { type: 'file', value: '.txt' },
      { type: 'text', value: ' ' },
    ]);
  });

  it('detects Chinese filenames at the start of a line', () => {
    const input = '.xlsx - Excel';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'file', value: '.xlsx' },
      { type: 'text', value: ' - Excel' },
    ]);
  });

  it('detects absolute paths', () => {
    const input = ' /Users/haoqing/test/.docx ';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: ' ' },
      { type: 'file', value: '/Users/haoqing/test/.docx' },
      { type: 'text', value: ' ' },
    ]);
  });

  it('detects absolute paths with spaces', () => {
    const input = '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/word-document/.docx';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: '' },
      { type: 'file', value: '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/word-document/.docx' },
    ]);
  });

  it('ignores urls', () => {
    const input = ' https://example.com/demo.txt';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('does not treat numeric dimensions as filenames', () => {
    const input = 'HTML10.0" × 5.6" (16:9)';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('ignores filenames embedded in Chinese sentences without boundaries', () => {
    const input = 'slide1.htmlslide2.html:';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('provides a left-aligned file link button class', () => {
    const className = getFileLinkButtonClassName();
    expect(className).toContain('text-left');
    expect(className).toContain('break-all');
  });

  it('splits string children into file and text parts', () => {
    const parts = splitChildrenByFileMentions(['simple.md - ']);
    expect(parts).toEqual([
      { type: 'file', value: 'simple.md' },
      { type: 'text', value: ' - ' },
    ]);
  });
});
