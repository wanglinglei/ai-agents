import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { ErrorCode } from '../../common/config/error-code.config';
import { UserStatus } from '../entitys/user.entity';
import { UserService } from '../user.service';

class UnauthorizedExceptionWithCode extends UnauthorizedException {
  constructor(
    message: string,
    public readonly errCode: ErrorCode,
  ) {
    super({ message, errCode });
  }
}

const extractJwtFromHeader = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return authHeader;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private userService: UserService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractJwtFromHeader]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
    });
  }

  /**
   * 校验 JWT payload 并返回挂载到 req.user 的字段。
   *
   * @param payload JWT 载荷。
   * @returns 鉴权用户信息。
   */
  async validate(payload: { sub?: number }): Promise<{
    userId: number;
    username: string;
    authScope: string;
  }> {
    if (!payload || !payload.sub) {
      throw new UnauthorizedExceptionWithCode(
        '无效的 token',
        ErrorCode.TOKEN_INVALID,
      );
    }

    const user = await this.userService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedExceptionWithCode(
        '用户不存在',
        ErrorCode.USER_NOT_FOUND,
      );
    }
    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedExceptionWithCode(
        '账户已被禁用',
        ErrorCode.USER_DISABLED,
      );
    }

    return {
      userId: user.id,
      username: user.username,
      authScope: user.authScope || '',
    };
  }
}
