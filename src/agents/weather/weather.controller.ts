import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { WeatherService } from './weather.service';
import type {
  WeatherAgentResponse,
  WeatherAgentStatus,
} from './types/weather-agent.types';

export interface WeatherQueryBody {
  conversationId?: string;
  message?: string;
}

@Controller('weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  /**
   * Returns weather agent integration status.
   *
   * @returns Weather agent configuration status.
   */
  @Get('status')
  getStatus(): WeatherAgentStatus {
    return this.weatherService.getStatus();
  }

  /**
   * Queries weather from a natural language request with conversation context.
   *
   * @param body Weather query request body.
   * @returns Weather agent response.
   */
  @Post('query')
  async queryByPost(
    @Body() body: WeatherQueryBody,
  ): Promise<WeatherAgentResponse> {
    return this.weatherService.query(body.message ?? '', body.conversationId);
  }

  /**
   * Streams only the weather answer text over a plain HTTP chunked response.
   *
   * @param body Weather query request body.
   * @param response Express response used for chunked output.
   */
  @Post('query/stream')
  async queryByStream(
    @Body() body: WeatherQueryBody,
    @Res() response: Response,
  ): Promise<void> {
    const message = body.message?.trim() ?? '';

    if (!message) {
      throw new BadRequestException('请提供天气查询内容。');
    }

    const conversationId = this.weatherService.resolveQueryConversationId(
      body.conversationId,
    );

    response.status(200);
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.setHeader('X-Conversation-Id', conversationId);
    response.setHeader('Access-Control-Expose-Headers', 'X-Conversation-Id');
    response.flushHeaders();

    try {
      await this.weatherService.streamQuery(
        message,
        conversationId,
        async (chunk) => {
          await this.writeResponseChunk(response, chunk);
        },
      );
    } catch (error) {
      await this.writeResponseChunk(
        response,
        error instanceof Error ? error.message : '天气查询失败，请稍后再试。',
      );
    } finally {
      response.end();
    }
  }

  /**
   * Writes a streamed answer chunk and waits for transport backpressure when needed.
   *
   * @param response Express response used for chunked output.
   * @param chunk Answer text chunk to write.
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
