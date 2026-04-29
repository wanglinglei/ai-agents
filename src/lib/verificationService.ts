/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

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
    if (!session) {
      this.logger.warn('Session is not available');
      return false;
    }

    const sessionCode = (session as any).emailCode;
    const sessionEmail = (session as any).emailCodeEmail;
    const expireTime = (session as any).emailCodeExpireTime;
    const now = Date.now();

    if (!sessionCode || !sessionEmail) {
      this.logger.warn('验证码不存在');
      return false;
    }

    if (expireTime && now > expireTime) {
      this.logger.warn('验证码已过期');
      delete (session as any).emailCode;
      delete (session as any).emailCodeEmail;
      delete (session as any).emailCodeExpireTime;
      return false;
    }

    const isValid = sessionEmail === email && sessionCode === code.toString();
    if (isValid) {
      delete (session as any).emailCode;
      delete (session as any).emailCodeEmail;
      delete (session as any).emailCodeLastSendTime;
      delete (session as any).emailCodeExpireTime;
      session.save((err) => {
        if (err) {
          this.logger.error('Session save error after verification:', err);
        }
      });
    }

    return isValid;
  }

  /**
   * 校验图形验证码。
   *
   * @param session Session 对象。
   * @param code 验证码。
   * @returns 是否通过。
   */
  verifyCaptcha(session: ExpressRequest['session'], code: string): boolean {
    if (!session) {
      this.logger.warn('Session is not available');
      return false;
    }

    const sessionCaptcha = (session as any).captcha;
    if (!code || !sessionCaptcha) {
      return false;
    }

    const isValid = sessionCaptcha === code.toLowerCase();
    delete (session as any).captcha;
    session.save((err) => {
      if (err) {
        this.logger.error('Session save error after verification:', err);
      }
    });

    return isValid;
  }
}
