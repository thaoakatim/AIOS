import { RecursiveTextSplitter } from './recursive-text-splitter';

describe('RecursiveTextSplitter', () => {
  let splitter: RecursiveTextSplitter;

  beforeEach(() => {
    splitter = new RecursiveTextSplitter();
  });

  it('returns empty array for empty or whitespace-only text', () => {
    expect(splitter.split('')).toEqual([]);
    expect(splitter.split('    \n\n   ')).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    const chunks = splitter.splitToStrings(
      'AIOS là Personal AI Operating System.',
    );
    expect(chunks).toEqual(['AIOS là Personal AI Operating System.']);
  });

  it('splits on paragraph boundaries first', () => {
    const text = `${'A'.repeat(90)}\n\n${'B'.repeat(90)}\n\n${'C'.repeat(90)}`;
    const chunks = splitter.splitToStrings(text, {
      chunkSize: 100,
      chunkOverlap: 0,
    });

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe('A'.repeat(90));
    expect(chunks[1]).toBe('B'.repeat(90));
    expect(chunks[2]).toBe('C'.repeat(90));
  });

  it('never exceeds chunkSize when splitting long single-line text', () => {
    const text = 'word '.repeat(2000);
    const chunks = splitter.splitToStrings(text, {
      chunkSize: 200,
      chunkOverlap: 20,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it('recursively falls back to word boundaries for oversized words', () => {
    const text = 'x'.repeat(500);
    const chunks = splitter.splitToStrings(text, {
      chunkSize: 100,
      chunkOverlap: 0,
    });

    expect(chunks).toHaveLength(5);
    for (const chunk of chunks) {
      expect(chunk).toHaveLength(100);
    }
  });

  it('falls back to fixed-width windows when no separator matches', () => {
    const text = 'y'.repeat(250);
    const chunks = splitter.splitToStrings(text, {
      chunkSize: 100,
      chunkOverlap: 0,
      separators: ['\n\n'],
    });

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
  });

  it('carries the tail of the previous chunk into the next one when overlapping', () => {
    // Văn bản nhiều từ nhỏ, không có ngắt đoạn -> segment là từng từ, nên
    // overlap có chỗ để mang đuôi chunk trước sang chunk kế tiếp.
    const words =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu';
    const noOverlap = splitter.splitToStrings(words, {
      chunkSize: 64,
      chunkOverlap: 0,
    });
    const withOverlap = splitter.splitToStrings(words, {
      chunkSize: 64,
      chunkOverlap: 24,
    });

    expect(noOverlap.length).toBeLessThan(withOverlap.length);
    for (const chunk of withOverlap) {
      expect(chunk.length).toBeLessThanOrEqual(64);
    }

    // Overlap bảo đảm không mất từ nào của văn bản gốc.
    const joined = withOverlap.join(' ');
    for (const word of words.split(' ')) {
      expect(joined).toContain(word);
    }
  });

  it('preserves the original text when re-joining pieces', () => {
    // Hồi quy: nếu trim từng piece, khoảng trắng giữa các từ biến mất và
    // chunk thành "alphabravo" -> văn bản đưa vào embedding bị sai.
    const text =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike';
    const chunks = splitter.splitToStrings(text, {
      chunkSize: 64,
      chunkOverlap: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toMatch(/\w \w/u);
      expect(text).toContain(chunk);
    }
  });

  it('reports offsets that map back into the original text', () => {
    const text = `${'A'.repeat(90)}\n\n${'B'.repeat(90)}\n\n${'C'.repeat(90)}`;
    const chunks = splitter.split(text, { chunkSize: 100, chunkOverlap: 0 });

    expect(chunks).toHaveLength(3);
    chunks.forEach((chunk, index) => {
      expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text);
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeLessThanOrEqual(text.length);
      // Các chunk không chồng lấn khi overlap = 0.
      if (index > 0) {
        expect(chunk.start).toBeGreaterThan(chunks[index - 1].end);
      }
    });
  });

  it('rejects an overlap that is >= chunkSize to avoid an infinite loop', () => {
    const text = 'Some content here. '.repeat(50);
    const chunks = splitter.splitToStrings(text, {
      chunkSize: 100,
      chunkOverlap: 500,
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it('clamps chunkSize up to the minimum instead of ignoring the request', () => {
    const text = 'Tiny document.';
    const chunks = splitter.splitToStrings(text, { chunkSize: 1 });
    expect(chunks).toEqual(['Tiny document.']);

    const long = 'z'.repeat(200);
    const clamped = splitter.splitToStrings(long, {
      chunkSize: 1,
      chunkOverlap: 0,
    });
    expect(clamped).toHaveLength(4);
    expect(clamped[0]).toHaveLength(64);
  });
});
