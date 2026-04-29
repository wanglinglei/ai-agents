import { AlipaySdk } from 'alipay-sdk';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { UserService } from '../user/user.service';

dotenv.config();

interface AlipayUserInfoResponse {
  nickName?: string;
  avatar?: string;
  gender?: string;
  code?: string;
  msg?: string;
  province?: string;
  city?: string;
}

interface AuthCallbackResult {
  accessToken: string;
  userInfo: {
    id: number;
    username: string;
    nickname: string;
    email?: string;
    avatar?: string;
    province?: string;
    city?: string;
  };
}

@Injectable()
export class AlipayAuthService {
  private readonly appId: string = '2021006105634443';
  private readonly appPrivateKey: string;
  private readonly alipayPublicKey: string;
  private readonly alipaySdk: AlipaySdk;
  private readonly logger = new Logger(AlipayAuthService.name);

  constructor(private userService: UserService) {
    this.appPrivateKey = process.env.APP_PRIVATE_KEY || '';
    this.alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY || '';
    this.alipaySdk = new AlipaySdk({
      appId: this.appId,
      privateKey: this.appPrivateKey,
      alipayPublicKey: this.alipayPublicKey,
    });
  }

  /**
   * 使用 authCode 登录并返回本系统 token。
   *
   * @param authCode 支付宝授权码。
   * @returns 登录结果。
   */
  async loginByAuthCode(authCode: string): Promise<AuthCallbackResult> {
    try {
      if (!authCode) {
        throw new BadRequestException('缺少授权码');
      }

      const tokenResult = await this.alipaySdk.exec(
        'alipay.system.oauth.token',
        {
          grant_type: 'authorization_code',
          code: authCode,
        },
      );

      const { accessToken, openId } = tokenResult as unknown as {
        accessToken: string;
        openId: string;
      };
      const alipayUserInfo = await this.getUserInfo(accessToken);
      let user = await this.userService.findBySourceUserId(openId);

      const { nickName, avatar, gender, province, city } = alipayUserInfo;
      if (!user) {
        const nickname = nickName || '支付宝用户';
        user = await this.userService.createAlipayUser({
          username: null,
          nickname,
          alipayUserId: openId,
          avatar,
          gender:
            gender === 'm' ? 'male' : gender === 'f' ? 'female' : 'unknown',
          province,
          city,
        });
      } else {
        if (alipayUserInfo.nickName) {
          user.nickname = alipayUserInfo.nickName;
        }
        if (alipayUserInfo.avatar) {
          user.avatar = alipayUserInfo.avatar;
        }
        await this.userService.updateUser(user);
      }

      const jwtToken = this.userService.generateToken(user);
      return {
        accessToken: jwtToken,
        userInfo: {
          id: user.id,
          username: user.username,
          nickname: user.nickname,
          email: user.email,
          avatar: user.avatar,
          province: user.province,
          city: user.city,
        },
      };
    } catch (error) {
      this.logger.error(`loginByAuthCode error: ${String(error)}`);
      throw new BadRequestException('登录失败');
    }
  }

  /**
   * 调用支付宝接口拉取用户信息。
   *
   * @param accessToken 支付宝访问令牌。
   * @returns 用户信息。
   */
  async getUserInfo(accessToken: string): Promise<AlipayUserInfoResponse> {
    const userInfo = await this.alipaySdk.exec('alipay.user.info.share', {
      auth_token: accessToken,
    });
    if (!userInfo) {
      throw new Error('获取用户信息失败：响应格式错误');
    }
    return userInfo;
  }
}
