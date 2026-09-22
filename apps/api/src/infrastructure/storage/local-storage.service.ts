import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface StoredFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  url: string;
  uploadedAt: Date;
}

@Injectable()
export class LocalStorageService {
  private readonly storagePath: string;
  private readonly baseUrl: string;
  private readonly logger = new Logger(LocalStorageService.name);

  constructor(private readonly config: ConfigService) {
    this.storagePath =
      this.config.get('LOCAL_STORAGE_PATH') || './data/storage';
    this.baseUrl = this.config.get('STORAGE_BASE_URL') || '/api/files';
    this.ensureStorageDirectory();
  }

  private async ensureStorageDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
      this.logger.log(`Storage directory ready: ${this.storagePath}`);
    } catch (error) {
      this.logger.error('Failed to create storage directory:', error);
      throw error;
    }
  }

  async saveFile(
    file: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<StoredFile> {
    const id = crypto.randomUUID();
    const extension =
      path.extname(originalName) || this.getExtensionFromMimeType(mimeType);
    const filename = `${id}${extension}`;
    const filePath = path.join(this.storagePath, filename);

    await fs.writeFile(filePath, file);

    const stats = await fs.stat(filePath);

    return {
      id,
      originalName,
      mimeType,
      size: stats.size,
      path: filePath,
      url: `${this.baseUrl}/${filename}`,
      uploadedAt: new Date(),
    };
  }

  async saveFileFromPath(
    sourcePath: string,
    originalName: string,
    mimeType: string,
  ): Promise<StoredFile> {
    const id = crypto.randomUUID();
    const extension =
      path.extname(originalName) || this.getExtensionFromMimeType(mimeType);
    const filename = `${id}${extension}`;
    const filePath = path.join(this.storagePath, filename);

    await fs.copyFile(sourcePath, filePath);

    const stats = await fs.stat(filePath);

    return {
      id,
      originalName,
      mimeType,
      size: stats.size,
      path: filePath,
      url: `${this.baseUrl}/${filename}`,
      uploadedAt: new Date(),
    };
  }

  async getFile(id: string): Promise<Buffer | null> {
    try {
      const files = await fs.readdir(this.storagePath);
      const file = files.find((f) => f.startsWith(id));
      if (!file) return null;

      const filePath = path.join(this.storagePath, file);
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async getFileStream(id: string): Promise<{
    stream: NodeJS.ReadableStream;
    mimeType: string;
    size: number;
  } | null> {
    try {
      const files = await fs.readdir(this.storagePath);
      const file = files.find((f) => f.startsWith(id));
      if (!file) return null;

      const filePath = path.join(this.storagePath, file);
      const stats = await fs.stat(filePath);
      const stream = require('fs').createReadStream(filePath);

      return {
        stream,
        mimeType: this.getMimeTypeFromExtension(path.extname(file)),
        size: stats.size,
      };
    } catch {
      return null;
    }
  }

  async deleteFile(id: string): Promise<boolean> {
    try {
      const files = await fs.readdir(this.storagePath);
      const file = files.find((f) => f.startsWith(id));
      if (!file) return false;

      await fs.unlink(path.join(this.storagePath, file));
      return true;
    } catch {
      return false;
    }
  }

  async fileExists(id: string): Promise<boolean> {
    try {
      const files = await fs.readdir(this.storagePath);
      return files.some((f) => f.startsWith(id));
    } catch {
      return false;
    }
  }

  async listFiles(): Promise<StoredFile[]> {
    try {
      const files = await fs.readdir(this.storagePath);
      const result: StoredFile[] = [];

      for (const file of files) {
        const filePath = path.join(this.storagePath, file);
        const stats = await fs.stat(filePath);
        const id = path.parse(file).name;

        result.push({
          id,
          originalName: file,
          mimeType: this.getMimeTypeFromExtension(path.extname(file)),
          size: stats.size,
          path: filePath,
          url: `${this.baseUrl}/${file}`,
          uploadedAt: stats.birthtime,
        });
      }

      return result.sort(
        (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
      );
    } catch {
      return [];
    }
  }

  getStoragePath(): string {
    return this.storagePath;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const map: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        '.docx',
      'text/plain': '.txt',
      'text/markdown': '.md',
      'application/json': '.json',
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
    };
    return map[mimeType] || '.bin';
  }

  private getMimeTypeFromExtension(ext: string): string {
    const map: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
    };
    return map[ext.toLowerCase()] || 'application/octet-stream';
  }
}
