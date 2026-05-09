import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { DataAnalyseService } from './data-analyse.service';
import type {
  DataAnalyseAgentStatus,
  DataAnalyseDbType,
  DataAnalyseQueryRequest,
} from './types/data-analyse-agent.types';

/**
 * Data analyse 查询请求体。
 */
export interface DataAnalyseQueryBody {
  /** 会话 ID，可选。 */
  conversationId?: string;
  /** 用户问题。 */
  message?: string;
  /** 数据库类型。 */
  dbType?: DataAnalyseDbType;
  /** 数据库地址。 */
  host?: string;
  /** 端口。 */
  port?: number;
  /** 账号。 */
  username?: string;
  /** 密码。 */
  password?: string;
  /** 数据库名。 */
  database?: string;
  /** 表名。 */
  table?: string;
}

@Controller('data-analyse')
export class DataAnalyseController {
  constructor(private readonly dataAnalyseService: DataAnalyseService) {}

  /**
   * 返回 data-analyse agent 接入状态。
   *
   * @returns Agent 状态。
   */
  @Get('status')
  getStatus(): DataAnalyseAgentStatus {
    return this.dataAnalyseService.getStatus();
  }

  /**
   * 以纯文本分片方式流式返回最终分析回答。
   *
   * @param body 查询请求体。
   * @param response Express response。
   */
  @Post('query/stream')
  async queryByStream(
    @Body() body: DataAnalyseQueryBody,
    @Res() response: Response,
  ): Promise<void> {
    const normalizedRequest = this.normalizeQueryBody(body);
    const conversationId = this.dataAnalyseService.resolveQueryConversationId(
      normalizedRequest.conversationId,
    );

    normalizedRequest.conversationId = conversationId;

    response.status(200);
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.setHeader('X-Conversation-Id', conversationId);
    response.setHeader('Access-Control-Expose-Headers', '*');

    try {
      await this.dataAnalyseService.streamQuery(
        normalizedRequest,
        async (chunk) => {
          await this.writeResponseChunk(response, chunk);
        },
        (meta) => {
          if (response.writableEnded) {
            return;
          }

          if (meta.status) {
            response.setHeader('X-Data-Analyse-Status', meta.status);
          }

          if (meta.rowCount !== undefined) {
            response.setHeader(
              'X-Data-Analyse-Row-Count',
              String(meta.rowCount),
            );
          }

          if (meta.sql) {
            response.setHeader(
              'X-Data-Analyse-Sql',
              encodeURIComponent(meta.sql),
            );
          }
        },
      );
    } catch (error) {
      await this.writeResponseChunk(
        response,
        error instanceof Error
          ? error.message
          : '数据分析查询失败，请稍后再试。',
      );
    } finally {
      response.end();
    }
  }

  /**
   * 规范化并校验查询请求体。
   *
   * @param body 原始请求体。
   * @returns 标准化请求参数。
   */
  private normalizeQueryBody(
    body: DataAnalyseQueryBody,
  ): DataAnalyseQueryRequest {
    const message = body.message?.trim() ?? '';

    if (!message) {
      throw new BadRequestException('请提供数据分析问题。');
    }

    if (
      !body.dbType ||
      !body.host ||
      !body.port ||
      !body.username ||
      !body.password
    ) {
      throw new BadRequestException('请提供完整数据库连接信息。');
    }

    if (!body.database || !body.table) {
      throw new BadRequestException('请提供数据库名和表名。');
    }

    return {
      connection: {
        database: body.database,
        dbType: body.dbType,
        host: body.host,
        password: body.password,
        port: body.port,
        username: body.username,
      },
      conversationId: body.conversationId,
      message,
      table: body.table,
    };
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
