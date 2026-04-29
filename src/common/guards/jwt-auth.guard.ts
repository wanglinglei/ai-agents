/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { ErrorCode } from '../config/error-code.config';
import { isWhitelisted } from '../config/auth.config';
import { validatePermission } from '../utils/permission.util';

class UnauthorizedExceptionWithCode extends UnauthorizedException {
  constructor(
    message: string,
    public readonly errCode: ErrorCode,
  ) {
    super({ message, errCode });
  }
}

export interface JwtUser {
  userId: number;
  username: string;
  authScope: string;
}

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  /**
   * 判断请求是否可跳过鉴权。
   *
   * @param context Nest 执行上下文。
   * @returns 是否允许通过。
   */
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const path = request.url?.split('?')[0] || '';
    if (isWhitelisted(path)) {
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * 统一处理 JWT 认证后的用户信息与异常。
   *
   * @param err Passport 抛出的异常。
   * @param user Passport 解析出的用户。
   * @param _info Passport 附加信息。
   * @param context Nest 执行上下文。
   * @returns 认证通过的用户信息。
   */
  handleRequest<TUser = JwtUser>(
    err: any,
    user: any,
    _info: any,
    context: ExecutionContext,
  ): TUser {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.url?.split('?')[0] || '';

    if (err) {
      const isExpiredError =
        (err &&
          typeof err === 'object' &&
          'name' in err &&
          (err as { name?: string }).name === 'TokenExpiredError') ||
        (err &&
          typeof err === 'object' &&
          'message' in err &&
          typeof (err as { message?: unknown }).message === 'string' &&
          ((err as { message: string }).message.includes('expired') ||
            (err as { message: string }).message.includes('过期')));

      if (isExpiredError) {
        throw new UnauthorizedExceptionWithCode(
          'Token 已过期，请重新登录',
          ErrorCode.TOKEN_EXPIRED,
        );
      }

      throw err instanceof UnauthorizedException
        ? err
        : new UnauthorizedExceptionWithCode(
            '未授权，请先登录',
            ErrorCode.UNAUTHORIZED,
          );
    }

    if (!user) {
      throw new UnauthorizedExceptionWithCode(
        '未授权，请先登录',
        ErrorCode.UNAUTHORIZED,
      );
    }

    const jwtUser = user as JwtUser;
    if (jwtUser.authScope) {
      validatePermission(jwtUser.authScope, path);
    }

    return user as TUser;
  }
}
