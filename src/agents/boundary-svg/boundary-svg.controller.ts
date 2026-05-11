import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { BoundarySvgService } from './boundary-svg.service';
import type { BoundarySvgAgentStatus } from './types/boundary-svg-agent.types';

/**
 * boundary-svg 查询请求体。
 */
export interface BoundarySvgQueryBody {
  /** 会话 ID，可选。 */
  conversationId?: string;
  /** 用户问题。 */
  message?: string;
}

@Controller('boundary-svg')
export class BoundarySvgController {
  constructor(private readonly boundarySvgService: BoundarySvgService) {}

  /**
   * 返回 boundary-svg Agent 状态。
   *
   * @returns Agent 状态。
   */
  @Get('status')
  getStatus(): BoundarySvgAgentStatus {
    return this.boundarySvgService.getStatus();
  }

  /**
   * 以纯文本分片方式流式返回 boundary-svg 回答。
   *
   * @param body 查询请求体。
   * @param response Express response。
   */
  @Post('query/stream')
  async queryByStream(
    @Body() body: BoundarySvgQueryBody,
    @Res() response: Response,
  ): Promise<void> {
    const message = body.message?.trim() ?? '';
    if (!message) {
      throw new BadRequestException('请提供边界查询内容。');
    }

    const conversationId = this.boundarySvgService.resolveQueryConversationId(
      body.conversationId,
    );

    response.status(200);
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.setHeader('X-Conversation-Id', conversationId);
    response.setHeader('Access-Control-Expose-Headers', '*');
    response.flushHeaders();

    try {
      await this.boundarySvgService.streamQuery(
        message,
        conversationId,
        async (chunk) => {
          await this.writeResponseChunk(response, chunk);
        },
      );
    } catch (error) {
      await this.writeResponseChunk(
        response,
        error instanceof Error ? error.message : '边界查询失败，请稍后再试。',
      );
    } finally {
      response.end();
    }
  }

  /**
   * 写入流式文本分片并处理背压。
   *
   * @param response Express response。
   * @param chunk 文本分片。
   */
  private async writeResponseChunk(
    response: Response,
    chunk: string,
  ): Promise<void> {
    if (!chunk || response.writableEnded) {
      return;
    }

    const canContinue = response.write(chunk);
    if (!canContinue) {
      await new Promise<void>((resolve) => {
        response.once('drain', resolve);
      });
    }
  }
}
