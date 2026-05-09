/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { BitifulService } from '../lib/bitifulService';
import { UploadImageResult } from '../lib/bitifulService';
import { VerificationService } from '../lib/verificationService';
import * as dotenv from 'dotenv';
import * as nodemailer from 'nodemailer';
import * as svgCaptcha from 'svg-captcha';

dotenv.config();

const emailUser = '18627024279@163.com';
const emailHost = 'smtp.163.com';
const emailPort = 465;

@Injectable()
export class GeneralService {
  private readonly logger = new Logger(GeneralService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly bitifulService: BitifulService,
    private readonly verificationService: VerificationService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: emailHost,
      port: emailPort,
      secure: true,
      auth: {
        user: emailUser,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  /**
   * 生成图形验证码并写入 session。
   *
   * @param session Session 对象。
   * @returns 验证码 svg 字符串。
   */
  async getCaptcha(
    session: ExpressRequest['session'],
  ): Promise<{ data: string }> {
    if (!session) {
      throw new Error('Session is not available');
    }

    const captcha = svgCaptcha.create({
      size: 4,
      ignoreChars: '0o1il',
      noise: 3,
      color: true,
      background: '#f0f0f0',
      width: 120,
      height: 40,
      fontSize: 50,
      charPreset: '123456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ',
    });

    (session as any).captcha = captcha.text.toLowerCase();

    return new Promise((resolve, reject) => {
      session.save((err) => {
        if (err) {
          this.logger.error('Session save error:', err);
          reject(new Error(`Session save failed: ${err.message || err}`));
        } else {
          resolve({ data: captcha.data });
        }
      });
    });
  }

  /**
   * 发送邮箱验证码并写入 session。
   *
   * @param session Session 对象。
   * @param email 目标邮箱。
   * @returns 发送结果。
   */
  async sendEmailCode(
    session: ExpressRequest['session'],
    email: string,
  ): Promise<{ success: boolean; message?: string }> {
    if (!session) {
      throw new BadRequestException('Session 不可用');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }

    if (!process.env.EMAIL_PASS) {
      throw new BadRequestException('邮箱服务未配置');
    }

    const lastSendTime = (session as any).emailCodeLastSendTime;
    const now = Date.now();
    if (lastSendTime && now - lastSendTime < 60000) {
      throw new BadRequestException('发送过于频繁，请稍后再试');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    (session as any).emailCode = code;
    (session as any).emailCodeEmail = email;
    (session as any).emailCodeLastSendTime = now;
    (session as any).emailCodeExpireTime = now + 10 * 60 * 1000;

    const mailOptions = {
      from: `"magicAI" <${emailUser}>`,
      to: email,
      subject: '邮箱验证码',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;font-size:20px;">邮箱验证码</h2>
          <p style="color: #666; font-size: 16px;">您好，</p>
          <p style="color: #666; font-size: 16px;">您的验证码是：</p>
          <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px;">
            <span style="font-size: 32px; font-weight: bold; color: #1890ff; letter-spacing: 5px;">${code}</span>
          </div>
          <p style="color: #999; font-size: 14px;">验证码有效期为 10 分钟，请勿泄露给他人。</p>
          <p style="color: #999; font-size: 14px;">验证码由系统自动生成，请勿回复此邮件。</p>
          <p style="color: #999; font-size: 14px;">如非本人操作，请忽略此邮件。</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      return new Promise((resolve, reject) => {
        session.save((err) => {
          if (err) {
            reject(new BadRequestException('发送失败，请稍后重试'));
          } else {
            resolve({ success: true, message: '验证码已发送到您的邮箱' });
          }
        });
      });
    } catch (error) {
      delete (session as any).emailCode;
      delete (session as any).emailCodeEmail;
      delete (session as any).emailCodeLastSendTime;
      delete (session as any).emailCodeExpireTime;

      const errorMessage =
        error instanceof Error
          ? `发送失败: ${error.message}`
          : '发送失败，请稍后重试';
      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * 校验邮箱验证码。
   *
   * @param session Session 对象。
   * @param email 邮箱。
   * @param code 验证码。
   * @returns 是否通过。
   */
  verifyEmailCode(
    session: ExpressRequest['session'],
    email: string,
    code: string,
  ): boolean {
    return this.verificationService.verifyEmailCode(session, email, code);
  }

  /**
   * 校验图形验证码。
   *
   * @param session Session 对象。
   * @param code 验证码。
   * @returns 是否通过。
   */
  verifyCaptcha(session: ExpressRequest['session'], code: string): boolean {
    return this.verificationService.verifyCaptcha(session, code);
  }

  /**
   * 上传图片到缤纷云对象存储。
   *
   * @param file 上传文件。
   * @returns 文件 URL 与 key。
   */
  async upload(
    file: Express.Multer.File,
  ): Promise<{ url: string; key: string }> {
    if (!file) {
      throw new BadRequestException('文件不能为空');
    }

    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `不支持的文件类型: ${file.mimetype}，仅支持图片格式`,
      );
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('文件大小不能超过 10MB');
    }

    try {
      const result: UploadImageResult =
        await this.bitifulService.uploadFile(file);
      return { url: result.publicUrl, key: result.key };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '文件上传失败',
      );
    }
  }
}
