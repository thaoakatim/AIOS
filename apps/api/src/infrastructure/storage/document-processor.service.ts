import { Injectable, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

export interface ExtractedDocument {
  text: string;
  metadata: {
    pageCount?: number;
    author?: string;
    title?: string;
    createdAt?: Date;
    modifiedAt?: Date;
  };
}

@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);

  async extractText(
    buffer: Buffer,
    mimeType: string,
  ): Promise<ExtractedDocument> {
    switch (mimeType) {
      case 'application/pdf':
        return this.extractFromPdf(buffer);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return this.extractFromDocx(buffer);
      case 'application/msword':
        return this.extractFromDoc(buffer);
      case 'text/plain':
      case 'text/markdown':
        return this.extractFromText(buffer);
      default:
        throw new Error(`Unsupported mime type: ${mimeType}`);
    }
  }

  private async extractFromPdf(buffer: Buffer): Promise<ExtractedDocument> {
    try {
      const data = await pdfParse(buffer);
      return {
        text: data.text,
        metadata: {
          pageCount: data.numpages,
          author: data.info?.Author,
          title: data.info?.Title,
          createdAt: data.info?.CreationDate
            ? new Date(data.info.CreationDate)
            : undefined,
          modifiedAt: data.info?.ModDate
            ? new Date(data.info.ModDate)
            : undefined,
        },
      };
    } catch (error) {
      this.logger.error('PDF extraction failed:', error);
      throw new Error('Failed to extract text from PDF');
    }
  }

  private async extractFromDocx(buffer: Buffer): Promise<ExtractedDocument> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value,
        metadata: {},
      };
    } catch (error) {
      this.logger.error('DOCX extraction failed:', error);
      throw new Error('Failed to extract text from DOCX');
    }
  }

  private async extractFromDoc(buffer: Buffer): Promise<ExtractedDocument> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value,
        metadata: {},
      };
    } catch (error) {
      this.logger.error('DOC extraction failed:', error);
      throw new Error('Failed to extract text from DOC');
    }
  }

  private async extractFromText(buffer: Buffer): Promise<ExtractedDocument> {
    return {
      text: buffer.toString('utf-8'),
      metadata: {},
    };
  }

  splitIntoChunks(text: string, chunkSize = 1000, overlap = 200): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);
      let chunk = text.slice(start, end);

      if (end < text.length) {
        const lastSpace = chunk.lastIndexOf(' ');
        const lastNewline = chunk.lastIndexOf('\n');
        const breakPoint = Math.max(lastSpace, lastNewline);
        if (breakPoint > chunkSize * 0.5) {
          chunk = chunk.slice(0, breakPoint);
          end = start + breakPoint;
        }
      }

      chunks.push(chunk.trim());
      start = end - overlap;
    }

    return chunks.filter((c) => c.length > 0);
  }
}
