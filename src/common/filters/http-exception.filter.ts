import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { UnifiedResponse } from '../../services/http/types';
import { ErrorCode } from '../config/error-code.config';

interface ExceptionResponse {
  message?: string | string[];
  code?: number;
  errCode?: ErrorCode;
  [key: string]: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * 统一处理控制器异常并输出标准响应结构。
   *
   * @param exception 抛出的异常对象。
   * @param host Nest 参数宿主。
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let code = 500;
    let errCode: ErrorCode | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const responseObj = exceptionResponse as ExceptionResponse;
        const responseMessage = Array.isArray(responseObj.message)
          ? responseObj.message[0]
          : responseObj.message;
        message = responseMessage || exception.message || '请求失败';
        code = responseObj.code || status;
        errCode = responseObj.errCode;
      } else {
        message = exception.message || '请求失败';
      }
      code = status;
    } else if (exception instanceof Error) {
      message = exception.message || '服务器内部错误';
      code = 500;
    }

    const route =
      (request.route as { path?: string } | undefined)?.path || request.url;
    const feature = this.extractFeature(route);

    if (status !== HttpStatus.UNAUTHORIZED && status !== HttpStatus.FORBIDDEN) {
      const logMessage = errCode
        ? `HTTP ${status} Error [${errCode}]: ${message}`
        : `HTTP ${status} Error: ${message}`;
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const errorResponse: UnifiedResponse = {
      success: false,
      message: message || '请求失败',
      code,
      feature,
      ...(errCode && { errCode }),
    };

    response.status(status).json(errorResponse);
  }

  /**
   * 从路由路径中提取功能名称。
   *
   * @param route 路由字符串。
   * @returns 功能名称。
   */
  private extractFeature(route: string): string | undefined {
    const routeMatch = route.match(/\/ai-service\/([^/]+)/);
    if (routeMatch) {
      return routeMatch[1];
    }

    const directMatch = route.match(/\/([^/]+)/);
    if (directMatch && directMatch[1] !== 'ai-service') {
      return directMatch[1];
    }

    return undefined;
  }
}
