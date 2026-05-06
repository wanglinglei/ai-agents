import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

dotenv.config();

/**
 * 判断请求来源是否允许跨域访问。
 *
 * @param origin 请求头中的 Origin。
 * @param frontendOrigin 配置的前端来源。
 * @returns 是否允许该来源跨域访问。
 */
function isAllowedCorsOrigin(
  origin: string | undefined,
  frontendOrigin: string,
): boolean {
  if (!origin) {
    return true;
  }

  const allowedOriginPatterns = [
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i,
    /^https:\/\/([a-z0-9-]+\.)*apifox\.(com|cn)$/i,
  ];

  return (
    origin === frontendOrigin ||
    allowedOriginPatterns.some((pattern) => pattern.test(origin))
  );
}

/**
 * 启动 Nest 应用并初始化全局中间件与前缀。
 *
 * @returns Promise resolved when application listens successfully.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, isAllowedCorsOrigin(origin, frontendOrigin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  app.use(
    session({
      name: 'ai-service.sid',
      secret: process.env.SESSION_SECRET || 'your-session-secret-key',
      resave: false,
      saveUninitialized: true,
      cookie: {
        maxAge: 3 * 60 * 1000,
        httpOnly: true,
        secure: false,
        ...(process.env.NODE_ENV === 'production' && { sameSite: 'lax' }),
      },
    }),
  );

  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('ai-agent');
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
