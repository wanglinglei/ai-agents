import { Body, Controller, Post } from '@nestjs/common';
import { AlipayAuthService } from './alipay-auth.service';

@Controller('alipay-auth')
export class AlipayAuthController {
  constructor(private readonly alipayAuthService: AlipayAuthService) {}

  /**
   * 通过支付宝 authCode 登录。
   *
   * @param authCode 支付宝授权码。
   * @returns 登录结果与 token。
   */
  @Post('login')
  async loginByAuthCode(
    @Body('authCode') authCode: string,
  ): ReturnType<AlipayAuthService['loginByAuthCode']> {
    return this.alipayAuthService.loginByAuthCode(authCode);
  }

  /**
   * 调试接口：通过 accessToken 获取支付宝用户信息。
   *
   * @param accessToken 支付宝 access token。
   * @returns 支付宝用户信息。
   */
  @Post('getUserInfo')
  async getUserInfo(
    @Body('accessToken') accessToken: string,
  ): ReturnType<AlipayAuthService['getUserInfo']> {
    return this.alipayAuthService.getUserInfo(accessToken);
  }
}
