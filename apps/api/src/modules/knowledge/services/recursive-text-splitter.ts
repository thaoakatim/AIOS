import { Injectable } from '@nestjs/common';

/**
 * Đoạn văn bản sau khi tách, kèm vị trí trong text gốc để làm metadata trích dẫn.
 */
export interface TextSegment {
  text: string;
  /** Offset bắt đầu trong text gốc (đã loại khoảng trắng thừa ở đầu). */
  start: number;
  /** Offset kết thúc (độc quyền) trong text gốc. */
  end: number;
}

export interface RecursiveSplitOptions {
  /** Độ dài tối đa của một chunk (ký tự). Mặc định 1200 (~300 token tiếng Việt). */
  chunkSize?: number;
  /** Số ký tự chồng lấn giữa hai chunk liên tiếp. Mặc định 200. */
  chunkOverlap?: number;
  /**
   * Thứ tự separator thử dùng, từ "ưu tiên giữ ngữ nghĩa" tới "thô nhất".
   * Chuỗi rỗng ở cuối nghĩa là cắt theo ký tự đơn lẻ.
   */
  separators?: string[];
}

export const DEFAULT_CHUNK_SIZE = 1200;
export const DEFAULT_CHUNK_OVERLAP = 200;
export const DEFAULT_SEPARATORS: readonly string[] = [
  '\n\n',
  '\n',
  '. ',
  '; ',
  ', ',
  ' ',
  '',
];

/**
 * RecursiveTextSplitter — bộ tách đoạn văn bản đệ quy (Task 2.2).
 *
 * Thuật toán (cùng tinh thần với Recursive Character Text Splitter của
 * LangChain): thử cắt bằng separator "đẹp nhất" (đường trống đôi → xuống
 * dòng → câu → dấu phẩy → khoảng trắng → ký tự). Với đoạn nào vẫn dài quá
 * `chunkSize`, đệ quy xuống separator kế tiếp cho tới khi đạt kích thước.
 *
 * Ưu điểm so với `DocumentProcessorService.splitIntoChunks` (cắt cứng theo độ
 * dài ký tự): không cắt giữa từ, không cắt giữa câu khi có thể tránh, và giữ
 * được offset để sinh citation "tài liệu + vị trí đoạn" cho câu trả lời RAG.
 *
 * Lớp thuần TypeScript, không phụ thuộc framework/SDK — dễ unit test.
 */
@Injectable()
export class RecursiveTextSplitter {
  split(text: string, options: RecursiveSplitOptions = {}): TextSegment[] {
    const chunkSize = this.normalizeChunkSize(
      options.chunkSize ?? DEFAULT_CHUNK_SIZE,
    );
    const chunkOverlap = this.normalizeOverlap(
      options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
      chunkSize,
    );
    const separators = this.normalizeSeparators(options.separators);

    const normalized = this.trimSegment({
      text,
      start: 0,
      end: text.length,
    });
    if (!normalized) return [];

    const segments = this.splitRecursive(normalized, separators, 0, chunkSize);
    const chunks = this.mergeSegments(segments, chunkSize, chunkOverlap);

    // Chunk rỗng (chỉ toàn khoảng trắng) không mang thông tin -> loại bỏ.
    return chunks.filter((chunk) => chunk.text.trim().length > 0);
  }

  /** Tiện lợi: chỉ lấy nội dung chữ của các chunk. */
  splitToStrings(text: string, options: RecursiveSplitOptions = {}): string[] {
    return this.split(text, options).map((segment) => segment.text);
  }

  // ------------------------------------------------------- Thuật toán ---

  /**
   * Tách đệ quy: mỗi segment được thử cắt bằng `separatorIndex`. Nếu segment
   * đã ngắn hơn `chunkSize` thì giữ nguyên, ngược lại đệ quy với separator kế.
   */
  private splitRecursive(
    segment: TextSegment,
    separators: readonly string[],
    separatorIndex: number,
    chunkSize: number,
  ): TextSegment[] {
    if (segment.text.length <= chunkSize) return [segment];

    // Hết separator khả dụng nhưng đoạn vẫn dài hơn chunkSize (ví dụ người
    // dùng truyền separators tùy chỉnh không chứa "") -> cắt cửa sổ cố định
    // để luôn tạo được chunk hợp lệ.
    if (separatorIndex >= separators.length) {
      return this.splitByFixedWidth(segment, chunkSize);
    }

    const separator = separators[separatorIndex];
    const pieces = this.splitBySeparator(segment, separator, chunkSize);
    if (pieces.length <= 1) {
      // Separator không xuất hiện trong đoạn này -> thử separator kế tiếp.
      return this.splitRecursive(
        segment,
        separators,
        separatorIndex + 1,
        chunkSize,
      );
    }

    return pieces.flatMap((piece) =>
      this.splitRecursive(piece, separators, separatorIndex + 1, chunkSize),
    );
  }

  /** Cắt một segment theo separator, giữ separator ở cuối mỗi piece để ghép lại. */
  private splitBySeparator(
    segment: TextSegment,
    separator: string,
    chunkSize: number,
  ): TextSegment[] {
    if (separator === '') {
      return this.splitByFixedWidth(segment, chunkSize);
    }

    const pieces: TextSegment[] = [];
    let cursor = 0;

    while (cursor < segment.text.length) {
      const found = segment.text.indexOf(separator, cursor);
      if (found === -1) break;

      const cut = found + separator.length;
      const piece = this.makeSegment({
        text: segment.text.slice(cursor, cut),
        start: segment.start + cursor,
        end: segment.start + cut,
      });
      if (piece) pieces.push(piece);
      cursor = cut;
    }

    const tail = this.makeSegment({
      text: segment.text.slice(cursor),
      start: segment.start + cursor,
      end: segment.end,
    });
    if (tail) pieces.push(tail);

    return pieces;
  }

  /** Fallback cuối cùng: cắt thành cửa sổ liên tiếp `chunkSize` ký tự. */
  private splitByFixedWidth(
    segment: TextSegment,
    chunkSize: number,
  ): TextSegment[] {
    const pieces: TextSegment[] = [];
    for (let i = 0; i < segment.text.length; i += chunkSize) {
      const piece = this.makeSegment({
        text: segment.text.slice(i, i + chunkSize),
        start: segment.start + i,
        end: segment.start + Math.min(i + chunkSize, segment.text.length),
      });
      if (piece) pieces.push(piece);
    }
    return pieces;
  }

  /**
   * Ghép các segment nhỏ lại thành chunk <= `chunkSize`, đồng thời giữ lại
   * phần đuôi của chunk trước (tối đa `chunkOverlap` ký tự) làm đầu chunk sau.
   */
  private mergeSegments(
    segments: TextSegment[],
    chunkSize: number,
    chunkOverlap: number,
  ): TextSegment[] {
    const chunks: TextSegment[] = [];
    let current: TextSegment[] = [];

    const totalLength = (list: TextSegment[]): number =>
      list.reduce((sum, segment) => sum + segment.text.length, 0);

    for (const segment of segments) {
      const currentLength = totalLength(current);

      if (
        current.length > 0 &&
        currentLength + segment.text.length > chunkSize
      ) {
        // Đóng chunk hiện tại rồi mang phần đuôi của nó sang chunk kế tiếp
        // để câu bị cắt ở ranh giới vẫn còn ngữ cảnh ở chunk kế tiếp.
        const flushed = current;
        chunks.push(this.joinSegments(flushed));

        const tail =
          chunkOverlap > 0 ? this.tailSegments(flushed, chunkOverlap) : [];
        current =
          totalLength(tail) + segment.text.length > chunkSize ? [] : tail;
      }

      current.push(segment);
    }

    if (current.length > 0) chunks.push(this.joinSegments(current));

    return chunks;
  }

  /** Các segment cuối cùng còn nằm trong `overlap` ký tự (giữ thứ tự gốc). */
  private tailSegments(
    segments: TextSegment[],
    overlap: number,
  ): TextSegment[] {
    const tail: TextSegment[] = [];
    let length = 0;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      if (length + segments[i].text.length > overlap) break;
      tail.unshift(segments[i]);
      length += segments[i].text.length;
    }
    return tail;
  }

  private joinSegments(segments: TextSegment[]): TextSegment {
    const first = segments[0];
    const last = segments[segments.length - 1];
    // Chỉ cắt khoảng trắng ở hai đầu chunk sau khi đã ghép — cắt sớm ở từng
    // piece sẽ làm mất khoảng trắng giữa các từ và nối liền "alpha bravo"
    // thành "alphabravo", làm hỏng văn bản đưa vào embedding.
    return (
      this.trimSegment({
        text: segments.map((segment) => segment.text).join(''),
        start: first.start,
        end: last.end,
      }) ?? { text: '', start: first.start, end: last.start }
    );
  }

  // ---------------------------------------------------------- Helpers ---

  /**
   * Tạo segment từ lát cắt thô: giữ nguyên khoảng trắng bên trong để ghép lại
   * khớp văn bản gốc, chỉ loại bỏ lát chỉ toàn khoảng trắng.
   */
  private makeSegment(segment: TextSegment): TextSegment | null {
    return segment.text.trim().length === 0 ? null : segment;
  }

  /** Loại khoảng trắng đầu/cuối và dịch offset cho khớp nội dung đã cắt. */
  private trimSegment(segment: TextSegment): TextSegment | null {
    const raw = segment.text;
    const leading = raw.length - raw.replace(/^\s+/u, '').length;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const trailing = raw.length - raw.replace(/\s+$/u, '').length;
    return {
      text: trimmed,
      start: segment.start + leading,
      end: segment.end - trailing,
    };
  }

  private normalizeChunkSize(chunkSize: number): number {
    if (!Number.isFinite(chunkSize)) return DEFAULT_CHUNK_SIZE;
    // Chunk quá nhỏ sẽ cắt nát câu/ngữ nghĩa -> nâng lên mức tối thiểu
    // thay vì âm thầm bỏ qua yêu cầu của caller.
    return Math.max(Math.floor(chunkSize), MIN_CHUNK_SIZE);
  }

  private normalizeOverlap(overlap: number, chunkSize: number): number {
    if (!Number.isFinite(overlap) || overlap < 0) return 0;
    const floored = Math.floor(overlap);
    // Overlap >= chunkSize sẽ khiến thuật toán lặp vô hạn -> chặn trần an toàn.
    return Math.min(floored, Math.floor(chunkSize / 2));
  }

  private normalizeSeparators(
    separators?: readonly string[],
  ): readonly string[] {
    // `Array.isArray` thu hẹp về `any[]` -> khai báo kiểu rõ ràng cho ESLint.
    const candidate: readonly string[] | undefined = Array.isArray(separators)
      ? (separators as readonly string[])
      : undefined;
    if (!candidate || candidate.length === 0) {
      return DEFAULT_SEPARATORS;
    }
    return candidate;
  }
}

/** Kích thước chunk tối thiểu — nhỏ hơn thì mất nghĩa, dùng giá trị mặc định. */
const MIN_CHUNK_SIZE = 64;
