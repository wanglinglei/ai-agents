/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { GeneralService } from './general.service';

@Controller('general')
export class GeneralController {
  constructor(private readonly generalService: GeneralService) {}

  /**
   * 健康检查接口。
   *
   * @returns 固定字符串。
   */
  @Get('/health')
  health(): string {
    return 'ok';
  }

  /**
   * 获取图形验证码图片（base64）。
   *
   * @param req Express 请求对象。
   * @returns 验证码图片数据。
   */
  @Get('/captcha')
  async getCaptcha(@Request() req: any): Promise<{ image: string }> {
    const { data } = await this.generalService.getCaptcha(req.session);
    return {
      image: `data:image/svg+xml;base64,${Buffer.from(data).toString('base64')}`,
    };
  }

  /**
   * 发送邮箱验证码。
   *
   * @param req Express 请求对象。
   * @param body 请求体。
   * @returns 发送结果。
   */
  @Post('/emailCode')
  async sendEmailCode(
    @Request() req: any,
    @Body() body: { email: string },
  ): Promise<{ success: boolean; message?: string }> {
    return this.generalService.sendEmailCode(req.session, body.email);
  }

  /**
   * 上传图片到缤纷云对象存储。
   *
   * @param file 上传文件。
   * @returns 文件 URL 与 key。
   */
  @Post('/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
      fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/svg+xml',
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new Error(`不支持的文件类型: ${file.mimetype}，仅支持图片格式`),
            false,
          );
        }
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string; key: string }> {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }
    return this.generalService.upload(file);
  }
}
