import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

dotenv.config();

/**
 * 启动 Nest 应用并初始化全局中间件与前缀。
 *
 * @returns Promise resolved when application listens successfully.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

  app.enableCors({
    origin: frontendOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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
  app.setGlobalPrefix('ai-service');
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
