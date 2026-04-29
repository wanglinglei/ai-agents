import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { AlipayAuthController } from './alipay-auth.controller';
import { AlipayAuthService } from './alipay-auth.service';

@Module({
  imports: [UserModule],
  controllers: [AlipayAuthController],
  providers: [AlipayAuthService],
})
export class AlipayAuthModule {}
