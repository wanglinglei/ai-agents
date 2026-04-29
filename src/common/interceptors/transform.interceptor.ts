import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UnifiedResponse } from '../../services/http/types';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  UnifiedResponse<T>
> {
  /**
   * 统一包装成功响应结构。
   *
   * @param context Nest 执行上下文。
   * @param next 下一个处理器。
   * @returns 标准化响应流。
   */
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<UnifiedResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const controller = context.getClass().name;
    const url = request.url || '';
    const routePath = (request as { route?: { path?: string } }).route?.path;
    const route = routePath || url;
    const feature = this.extractFeature(route, controller, url);

    return next.handle().pipe(
      map((data) => {
        return {
          success: true,
          data: data as T,
          code: 200,
          feature,
        };
      }),
    );
  }

  /**
   * 从路由或控制器名中推断功能名称。
   *
   * @param route 路由模板。
   * @param controller 控制器类名。
   * @param url 原始 URL。
   * @returns 功能名称。
   */
  private extractFeature(
    route: string,
    controller: string,
    url: string,
  ): string | undefined {
    const urlMatch = url.match(/\/ai-service\/([^/?]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }

    const routeMatch = route.match(/\/([^/]+)/);
    if (routeMatch && routeMatch[1] !== 'ai-service') {
      return routeMatch[1];
    }

    const controllerMatch = controller.match(/(\w+)Controller/);
    if (controllerMatch) {
      return controllerMatch[1].toLowerCase();
    }

    return undefined;
  }
}
