import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { AGENT_MESSAGE_ROLE } from '../../common/agents';
import { isLangChainLocalTraceEnabled } from '../../common/langchain/langchain-local-trace';
import { hasOpenAIApiKey } from '../../common/config/runtime-env.config';
import { AgentPersistenceService } from '../persistence/agent-persistence.service';
import { DataAnalyseExecutionService } from './data-analyse-execution.service';
import { DataAnalyseModelService } from './data-analyse-model.service';
import { DataAnalyseResponseService } from './data-analyse-response.service';
import type {
  DataAnalyseAgentResponse,
  DataAnalyseAgentStatus,
  DataAnalyseConnectionInput,
  DataAnalyseQueryRequest,
} from './types/data-analyse-agent.types';
import {
  buildApiFailureAnswer,
  buildFailedResponse,
  buildSuccessResponse,
} from './utils/data-analyse-responses';

const DATA_ANALYSE_AGENT_KEY = 'data_analyse';
const RESPONSE_ROWS_PREVIEW_LIMIT = 20;
type DataAnalyseAnswerChunkHandler = (chunk: string) => void | Promise<void>;
type DataAnalyseStreamMetadata = {
  rowCount?: number;
  sql?: string;
  status?: DataAnalyseAgentResponse['status'];
};
type DataAnalyseStreamMetadataHandler = (
  metadata: DataAnalyseStreamMetadata,
) => void;

@Injectable()
export class DataAnalyseService {
  constructor(
    private readonly agentPersistence: AgentPersistenceService,
    private readonly executionService: DataAnalyseExecutionService,
    private readonly modelService: DataAnalyseModelService,
    private readonly responseService: DataAnalyseResponseService,
  ) {}

  /**
   * 返回 data-analyse agent 运行状态。
   *
   * @returns 当前接入与配置状态。
   */
  getStatus(): DataAnalyseAgentStatus {
    return {
      hasApiKey: hasOpenAIApiKey(),
      integrated: true,
      localTrace: isLangChainLocalTraceEnabled(),
      model: this.modelService.getResponseModelName(),
      provider: 'OpenAICompatible',
      supportedDbTypes: ['mysql', 'postgres'],
    };
  }

  /**
   * 流式执行数据分析查询并按分片回传最终回答。
   *
   * @param request 查询请求。
   * @param onAnswerChunk 回答分片回调。
   * @param onMetadata 流式元信息回调。
   * @returns 数据分析响应。
   */
  async streamQuery(
    request: DataAnalyseQueryRequest,
    onAnswerChunk: DataAnalyseAnswerChunkHandler,
    onMetadata?: DataAnalyseStreamMetadataHandler,
  ): Promise<DataAnalyseAgentResponse> {
    return this.queryByRequest(request, onAnswerChunk, onMetadata);
  }

  /**
   * 解析或创建查询会话 ID。
   *
   * @param conversationId 可选会话 ID。
   * @returns 可用会话 ID。
   */
  resolveQueryConversationId(conversationId?: string): string {
    return this.resolveConversationId(conversationId);
  }

  /**
   * 按统一流程执行数据分析，可选流式输出最终回答。
   *
   * @param request 查询请求。
   * @param onAnswerChunk 回答分片回调。
   * @param onMetadata 流式元信息回调。
   * @returns 数据分析响应。
   */
  private async queryByRequest(
    request: DataAnalyseQueryRequest,
    onAnswerChunk?: DataAnalyseAnswerChunkHandler,
    onMetadata?: DataAnalyseStreamMetadataHandler,
  ): Promise<DataAnalyseAgentResponse> {
    const normalizedMessage = request.message.trim();
    const normalizedConversationId = this.resolveConversationId(
      request.conversationId,
    );

    if (!normalizedMessage) {
      throw new BadRequestException('请提供数据分析问题。');
    }

    const connection = this.normalizeConnectionInput(request.connection);
    const table = request.table.trim();

    if (!table) {
      throw new BadRequestException('请提供目标表名。');
    }

    const apiKey = this.modelService.ensureApiKey();
    const modelName = this.modelService.getResponseModelName();

    await this.agentPersistence.ensureConversation({
      agentKey: DATA_ANALYSE_AGENT_KEY,
      conversationId: normalizedConversationId,
      initialMessage: normalizedMessage,
      metadata: {
        dbType: connection.dbType,
      },
      titleMetadata: {
        table,
      },
    });

    const userMessage = await this.agentPersistence.createMessage({
      content: normalizedMessage,
      conversationId: normalizedConversationId,
      metadata: this.modelService.toJsonRecord({
        connection: this.buildSafeConnectionSnapshot(connection),
        table,
      }),
      role: AGENT_MESSAGE_ROLE.USER,
    });

    const run = await this.agentPersistence.createRun({
      agentKey: DATA_ANALYSE_AGENT_KEY,
      conversationId: normalizedConversationId,
      input: this.modelService.toJsonRecord({
        connection: this.buildSafeConnectionSnapshot(connection),
        question: normalizedMessage,
        table,
      }),
      model: modelName,
      provider: 'OpenAICompatible',
      userMessageId: userMessage.id,
    });

    let dataSource: DataSource | null = null;

    try {
      dataSource =
        await this.executionService.createAndInitializeDataSource(connection);
      const executionResult =
        await this.executionService.executeWithToolCalling({
          apiKey,
          connection,
          dataSource,
          message: normalizedMessage,
          table,
        });
      const { intent, queryResult, schema, sql: safeSql } = executionResult;

      if (onMetadata) {
        onMetadata({
          rowCount: queryResult.rowCount,
          sql: safeSql,
          status: 'success',
        });
      }

      const answer = onAnswerChunk
        ? await this.responseService.generateAnswerStream({
            apiKey,
            intent,
            onChunk: onAnswerChunk,
            question: normalizedMessage,
            rows: queryResult.rows,
            schema,
            sql: safeSql,
          })
        : await this.responseService.generateAnswer({
            apiKey,
            intent,
            question: normalizedMessage,
            rows: queryResult.rows,
            schema,
            sql: safeSql,
          });

      const successResponse = buildSuccessResponse({
        answer,
        conversationId: normalizedConversationId,
        intent,
        message: normalizedMessage,
        model: modelName,
        rowCount: queryResult.rowCount,
        rowsPreview: queryResult.rows.slice(0, RESPONSE_ROWS_PREVIEW_LIMIT),
        sql: safeSql,
      });

      await this.responseService.persistResponse({
        conversationId: normalizedConversationId,
        response: successResponse,
        runId: run.id,
        sql: safeSql,
        table,
      });

      return successResponse;
    } catch (error) {
      if (onMetadata) {
        onMetadata({
          status: 'failed',
        });
      }

      const failedResponse = buildFailedResponse({
        answer: buildApiFailureAnswer(normalizedMessage, error),
        conversationId: normalizedConversationId,
        message: normalizedMessage,
        model: modelName,
      });

      if (onAnswerChunk) {
        await onAnswerChunk(failedResponse.answer);
      }

      await this.responseService.persistFailedResponse(
        normalizedConversationId,
        run.id,
        failedResponse,
      );

      return failedResponse;
    } finally {
      await this.executionService.destroyDataSource(dataSource);
    }
  }

  /**
   * 解析或创建会话 ID。
   *
   * @param conversationId 传入会话 ID。
   * @returns 可用会话 ID。
   */
  private resolveConversationId(conversationId?: string): string {
    return conversationId?.trim() || randomUUID();
  }

  /**
   * 规范化并校验数据库连接输入。
   *
   * @param connection 连接输入。
   * @returns 规范化连接输入。
   */
  private normalizeConnectionInput(
    connection: DataAnalyseConnectionInput,
  ): DataAnalyseConnectionInput {
    const normalized = {
      database: connection.database?.trim(),
      dbType: connection.dbType,
      host: connection.host?.trim(),
      password: connection.password,
      port: Number(connection.port),
      username: connection.username?.trim(),
    };

    if (
      !normalized.host ||
      !normalized.username ||
      !normalized.password ||
      !normalized.database
    ) {
      throw new BadRequestException('数据库连接参数不完整。');
    }

    if (!Number.isInteger(normalized.port) || normalized.port <= 0) {
      throw new BadRequestException('数据库端口不合法。');
    }

    return normalized;
  }

  /**
   * 构建连接信息脱敏快照。
   *
   * @param connection 原始连接信息。
   * @returns 脱敏后的连接快照。
   */
  private buildSafeConnectionSnapshot(
    connection: DataAnalyseConnectionInput,
  ): Record<string, unknown> {
    return {
      database: connection.database,
      dbType: connection.dbType,
      host: connection.host,
      password: '***',
      port: connection.port,
      username: connection.username,
    };
  }
}
