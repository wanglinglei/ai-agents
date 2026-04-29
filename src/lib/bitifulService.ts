import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

export interface UploadImageResult {
  bucket: string;
  key: string;
  location: string;
  etag: string;
  publicUrl: string;
}

export interface DeleteFileResult {
  bucket: string;
  key: string;
  success: boolean;
}

dotenv.config();

@Injectable()
export class BitifulService {
  private readonly logger = new Logger(BitifulService.name);
  private bucket = process.env.BITIFUL_BUCKET || '1000010824-ai-agent';
  private prefix = process.env.BITIFUL_PREFIX || 'ai-agent';
  private endpoint = process.env.BITIFUL_ENDPOINT || 'https://s3.bitiful.net';
  private publicBaseUrl = process.env.BITIFUL_PUBLIC_BASE_URL || '';
  private region = process.env.BITIFUL_REGION || 'auto';
  private s3Client: S3Client;

  constructor() {
    this.s3Client = new S3Client({
      endpoint: this.endpoint,
      region: this.region,
      forcePathStyle: false,
      credentials: {
        accessKeyId: process.env.BITIFUL_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.BITIFUL_SECRET_ACCESS_KEY || '',
      },
    });
  }

  /**
   * 生成缤纷云文件 key。
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
   * 生成对象的可公开访问 URL。
   *
   * @param key 对象 key。
   * @returns 公网访问地址。
   */
  private buildPublicUrl(key: string): string {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
    }

    const endpointUrl = new URL(this.endpoint);
    return `${endpointUrl.protocol}//${this.bucket}.${endpointUrl.host}/${key}`;
  }

  /**
   * 上传文件到缤纷云对象存储。
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
    this.logger.log(`准备上传文件到缤纷云, key: ${key}, size: ${file.size}`);

    const result = await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000',
      }),
    );

    const publicUrl = this.buildPublicUrl(key);

    return {
      bucket: this.bucket,
      key,
      location: publicUrl,
      etag: result.ETag || '',
      publicUrl,
    };
  }

  /**
   * 从缤纷云对象存储删除文件。
   *
   * @param key 对象 key。
   * @returns 删除结果。
   */
  async deleteFile(key: string): Promise<DeleteFileResult> {
    if (!key) {
      throw new Error('key 不能为空');
    }

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    this.logger.log(`文件删除成功, key: ${key}`);

    return {
      bucket: this.bucket,
      key,
      success: true,
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
