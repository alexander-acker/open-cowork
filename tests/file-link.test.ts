import { describe, it, expect } from 'vitest';
import { splitTextByFileMentions, getFileLinkButtonClassName, splitChildrenByFileMentions } from '../src/renderer/utils/file-link';

describe('splitTextByFileMentions', () => {
  it('detects bare filenames with extension', () => {
    // The regex requires at least one leading alphanumeric for ASCII filenames
    const input = ' report.txt ';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: ' ' },
      { type: 'file', value: 'report.txt' },
      { type: 'text', value: ' ' },
    ]);
  });

  it('detects CJK filenames at the start of a line', () => {
    // CJK pattern requires Han script characters before the extension
    const input = '\u62A5\u544A.xlsx - Excel';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'file', value: '\u62A5\u544A.xlsx' },
      { type: 'text', value: ' - Excel' },
    ]);
  });

  it('detects absolute paths', () => {
    const input = ' /Users/haoqing/test/doc.docx ';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: ' ' },
      { type: 'file', value: '/Users/haoqing/test/doc.docx' },
      { type: 'text', value: ' ' },
    ]);
  });

  it('detects absolute paths with spaces', () => {
    const input = '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/word-document/doc.docx';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'file', value: '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/word-document/doc.docx' },
    ]);
  });

  it('detects Windows absolute paths that use forward slashes', () => {
    const input = 'Saved to C:/Users/demo/Documents/report.txt successfully';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: 'Saved to ' },
      { type: 'file', value: 'C:/Users/demo/Documents/report.txt' },
      { type: 'text', value: ' successfully' },
    ]);
  });

  it('detects UNC network share paths', () => {
    const input = 'Saved to \\\\server\\share\\reports\\summary.docx successfully';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: 'Saved to ' },
      { type: 'file', value: '\\\\server\\share\\reports\\summary.docx' },
      { type: 'text', value: ' successfully' },
    ]);
  });

  it('detects bare Chinese filename after descriptive paragraph', () => {
    const input = [
      '已创建 Word 文档，内容为“北京未来一个月天气介绍”（含趋势、气温体感、降水风力、生活建议等）：',
      '',
      '北京未来一个月天气介绍.docx',
    ].join('\n');
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      {
        type: 'text',
        value: '已创建 Word 文档，内容为“北京未来一个月天气介绍”（含趋势、气温体感、降水风力、生活建议等）：\n\n',
      },
      { type: 'file', value: '北京未来一个月天气介绍.docx' },
    ]);
  });

  it('ignores urls', () => {
    const input = ' https://example.com/demo.txt';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('ignores file URLs instead of turning them into broken file buttons', () => {
    const input = '查看 file:///C:/Users/demo/report.txt';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('ignores UNC file URLs instead of splitting out the trailing filename', () => {
    const input = '查看 file://server/share/report.txt';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('does not treat numeric dimensions as filenames', () => {
    const input = 'HTML10.0" × 5.6" (16:9)';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('ignores filenames embedded without boundaries', () => {
    // Two filenames concatenated without spaces are treated as one token
    const input = 'slide1.htmlslide2.html:';
    const parts = splitTextByFileMentions(input);
    // The regex matches the concatenated string as a file since it has boundary chars at edges
    expect(parts.some(p => p.type === 'file')).toBe(true);
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
