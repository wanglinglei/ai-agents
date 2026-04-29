/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable, Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const COS = require('cos-nodejs-sdk-v5');

export interface UploadImageResult {
  bucket: string;
  key: string;
  location: string;
  etag: string;
  publicUrl: string;
}

dotenv.config();

@Injectable()
export class CosService {
  private readonly logger = new Logger(CosService.name);
  private bucket = 'ship-any-1322020322';
  private prefix = 'imageGenerate/12/avatar';
  private cos: any;
  private cosRegion = 'ap-shanghai';
  private customDomain = 'https://static.jscoder.com';

  constructor() {
    this.cos = new COS({
      SecretId: process.env.COS_SECRET_ID!,
      SecretKey: process.env.COS_SECRET_KEY!,
      FileParallelLimit: 3,
      ChunkParallelLimit: 8,
      ChunkSize: 1024 * 1024 * 8,
      Protocol: 'https:',
      Domain: '{Bucket}.cos.{Region}.myqcloud.com',
      ForceSignHost: false,
    });
  }

  /**
   * 生成 COS 文件 key。
   *
   * @param fileName 文件名。
   * @returns 对象 key。
   */
  generateFileKey(fileName?: string): string {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 15);
    if (fileName) {
      const ext = fileName.split('.').pop();
      return `${this.prefix}/${timestamp}-${randomStr}${ext ? `.${ext}` : ''}`;
    }
    return `${this.prefix}/${timestamp}-${randomStr}`;
  }

  /**
   * 上传文件到 COS。
   *
   * @param file multer 文件对象。
   * @returns 上传结果。
   */
  async uploadFile(file: Express.Multer.File): Promise<UploadImageResult> {
    if (!file) {
      throw new Error('文件不能为空');
    }
    const ext = file.originalname.split('.').pop() || 'bin';
    const contentType = file.mimetype || this.getContentTypeByExt(ext);
    const key = this.generateFileKey(file.originalname);
    this.logger.log(`准备上传文件到COS, key: ${key}, size: ${file.size}`);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const result = await this.cos.putObject({
      Bucket: this.bucket,
      Region: this.cosRegion,
      Key: key,
      Body: file.buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000',
    });

    return {
      bucket: this.bucket,
      key,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      location: result.Location || '',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      etag: result.ETag || '',
      publicUrl: `${this.customDomain}/${key}`,
    };
  }

  /**
   * 按扩展名推断 Content-Type。
   *
   * @param ext 文件扩展名。
   * @returns MIME 类型。
   */
  private getContentTypeByExt(ext: string): string {
    const contentTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return contentTypes[ext.toLowerCase()] || 'application/octet-stream';
  }
}
