import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

/** Allowed image types, identified by file signature ("magic bytes"), not by the client's mimetype. */
const IMAGE_SIGNATURES: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.length > 6 && /^GIF8[79]a$/.test(b.toString('ascii', 0, 6)) },
];

export const PUBLIC_UPLOAD_PREFIX = '/uploads';

/**
 * File storage abstraction (HLD: object storage + CDN).
 * The default driver writes to local disk and the files are served from
 * `/uploads`. To move to S3-compatible storage, replace `saveImage` /
 * `deleteByUrl` with an S3 client — callers only depend on these methods.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly rootDir: string;
  private readonly publicBaseUrl: string;
  readonly maxFileSize: number;

  constructor(config: ConfigService) {
    this.rootDir = path.resolve(config.get<string>('UPLOAD_DIR', 'uploads'));
    const port = config.get<number>('PORT', 3001);
    this.publicBaseUrl = (config.get<string>('APP_URL') ?? `http://localhost:${port}`).replace(/\/+$/, '');
    this.maxFileSize = config.get<number>('UPLOAD_MAX_SIZE_MB', 5) * 1024 * 1024;
  }

  get uploadRoot(): string {
    return this.rootDir;
  }

  /** Throws INVALID_FILE unless the buffer is a supported image within the size limit. */
  assertImage(file: Express.Multer.File): { ext: string; mime: string } {
    if (!file?.buffer?.length) throw AppException.badRequest(ErrorCode.INVALID_FILE, 'Empty file');
    if (file.size > this.maxFileSize) {
      throw AppException.badRequest(ErrorCode.INVALID_FILE, `File exceeds ${this.maxFileSize} bytes`);
    }
    const match = IMAGE_SIGNATURES.find((s) => s.test(file.buffer));
    if (!match) {
      throw AppException.badRequest(
        ErrorCode.INVALID_FILE,
        `"${file.originalname}" is not a supported image (jpeg, png, webp, gif)`,
      );
    }
    return match;
  }

  /** Stores the image under a random name and returns its public URL. */
  async saveImage(file: Express.Multer.File, folder: string): Promise<string> {
    const { ext } = this.assertImage(file);
    const safeFolder = folder.replace(/[^a-z0-9-]/gi, '');
    const dir = path.join(this.rootDir, safeFolder);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}.${ext}`;
    await fs.writeFile(path.join(dir, filename), file.buffer);
    return `${this.publicBaseUrl}${PUBLIC_UPLOAD_PREFIX}/${safeFolder}/${filename}`;
  }

  /** Deletes a previously stored file. External URLs are ignored. Never throws. */
  async deleteByUrl(url: string): Promise<void> {
    const marker = `${PUBLIC_UPLOAD_PREFIX}/`;
    const idx = url.indexOf(marker);
    const isOwn = url.startsWith(this.publicBaseUrl + marker) || url.startsWith(marker);
    if (idx === -1 || !isOwn) return;
    const relative = url.slice(idx + marker.length);
    const target = path.resolve(this.rootDir, relative);
    // Path traversal guard: only delete inside the upload root.
    if (!target.startsWith(this.rootDir + path.sep)) return;
    try {
      await fs.unlink(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn({ url, err }, 'Failed to delete uploaded file');
      }
    }
  }
}
