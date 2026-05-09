import { BadRequestException, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  createLangChainLocalTraceConfig,
  isLangChainLocalTraceEnabled,
} from '../../common/langchain/langchain-local-trace';
import { AgentPersistenceService } from '../persistence/agent-persistence.service';
import { buildDataAnalyseAnswerPrompt } from './prompts/data-analyse-agent.prompt';
import { executeReadonlyQuery } from './tools/query-execute.tool';
import { inspectTableSchema } from './tools/schema-inspect.tool';
import type {
  DataAnalyseAgentResponse,
  DataAnalyseAgentStatus,
  DataAnalyseConnectionInput,
  DataAnalyseQueryRequest,
  DataAnalyseTableSchema,
} from './types/data-analyse-agent.types';
import {
  buildApiFailureAnswer,
  buildFailedResponse,
  buildSuccessResponse,
} from './utils/data-analyse-responses';

const DATA_ANALYSE_AGENT_KEY = 'data_analyse';
const OPENAI_COMPATIBLE_BASE_URL = process.env.OPENAI_COMPATIBLE_BASE_URL;
const RESPONSE_ROWS_LIMIT = 1000;
const RESPONSE_ROWS_PREVIEW_LIMIT = 20;
const ANSWER_ROWS_LIMIT = 50;
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
  constructor(private readonly agentPersistence: AgentPersistenceService) {}

  /**
   * 返回 data-analyse agent 运行状态。
   *
   * @returns 当前接入与配置状态。
   */
  getStatus(): DataAnalyseAgentStatus {
    return {
      hasApiKey: Boolean(process.env.OPENAI_API_KEY),
      integrated: true,
      localTrace: isLangChainLocalTraceEnabled(),
      model: this.getResponseModelName(),
      provider: 'OpenAICompatible',
      supportedDbTypes: ['mysql', 'postgres'],
    };
  }

  /**
   * 执行数据分析查询主流程。
   *
   * @param request 查询请求。
   * @returns 数据分析响应。
   */
  async query(
    request: DataAnalyseQueryRequest,
  ): Promise<DataAnalyseAgentResponse> {
    return this.queryByRequest(request);
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

    const apiKey = this.ensureApiKey();
    const modelName = this.getResponseModelName();

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
      metadata: this.toJsonRecord({
        connection: this.buildSafeConnectionSnapshot(connection),
        table,
      }),
      role: 'user',
    });

    const run = await this.agentPersistence.createRun({
      agentKey: DATA_ANALYSE_AGENT_KEY,
      conversationId: normalizedConversationId,
      input: this.toJsonRecord({
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
      dataSource = await this.createAndInitializeDataSource(connection);
      const schema = await inspectTableSchema(dataSource, connection, table);
      const safeSql = this.buildDefaultAnalysisSql(
        connection.dbType,
        schema.table,
      );
      const queryResult = await executeReadonlyQuery(dataSource, safeSql);
      const intent = `基于 ${schema.table} 全量字段数据分析：${normalizedMessage}`;

      if (onMetadata) {
        onMetadata({
          rowCount: queryResult.rowCount,
          sql: safeSql,
          status: 'success',
        });
      }

      const answer = onAnswerChunk
        ? await this.generateAnswerStream(
            apiKey,
            normalizedMessage,
            intent,
            safeSql,
            queryResult.rows,
            onAnswerChunk,
            schema,
          )
        : await this.generateAnswer(
            apiKey,
            normalizedMessage,
            intent,
            safeSql,
            queryResult.rows,
            schema,
          );

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

      await this.persistResponse({
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

      await this.persistFailedResponse(
        normalizedConversationId,
        run.id,
        failedResponse,
      );

      return failedResponse;
    } finally {
      await this.destroyDataSource(dataSource);
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
   * 创建并初始化动态数据源。
   *
   * @param connection 数据库连接参数。
   * @returns 可执行查询的数据源。
   */
  private async createAndInitializeDataSource(
    connection: DataAnalyseConnectionInput,
  ): Promise<DataSource> {
    const dataSource = new DataSource({
      database: connection.database,
      host: connection.host,
      logging: false,
      password: connection.password,
      port: connection.port,
      synchronize: false,
      type: connection.dbType,
      username: connection.username,
    });

    return dataSource.initialize();
  }

  /**
   * 销毁动态数据源，避免连接泄漏。
   *
   * @param dataSource 动态数据源。
   */
  private async destroyDataSource(
    dataSource: DataSource | null,
  ): Promise<void> {
    if (!dataSource?.isInitialized) {
      return;
    }

    await dataSource.destroy();
  }

  /**
   * 构建“全字段取数”分析 SQL。
   *
   * @param dbType 数据库类型。
   * @param table 表名。
   * @returns 默认分析 SQL。
   */
  private buildDefaultAnalysisSql(
    dbType: DataAnalyseConnectionInput['dbType'],
    table: string,
  ): string {
    const safeTable = this.escapeTableIdentifier(dbType, table);
    return `SELECT * FROM ${safeTable} LIMIT ${RESPONSE_ROWS_LIMIT}`;
  }

  /**
   * 对表名进行白名单校验并按方言转义。
   *
   * @param dbType 数据库类型。
   * @param table 原始表名（支持 schema.table）。
   * @returns 可安全拼接到 SQL 的表名。
   */
  private escapeTableIdentifier(
    dbType: DataAnalyseConnectionInput['dbType'],
    table: string,
  ): string {
    const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const segments = table.split('.').map((segment) => segment.trim());

    if (
      !segments.length ||
      segments.some((segment) => !identifierPattern.test(segment))
    ) {
      throw new BadRequestException(
        '表名格式不合法，仅支持字母数字下划线及 schema.table。',
      );
    }

    if (dbType === 'postgres') {
      return segments.map((segment) => `"${segment}"`).join('.');
    }

    return segments.map((segment) => `\`${segment}\``).join('.');
  }

  /**
   * 调用模型生成最终回答。
   *
   * @param apiKey 模型 API Key。
   * @param question 用户问题。
   * @param intent 识别意图。
   * @param sql 最终 SQL。
   * @param rows 查询结果。
   * @returns 生成的自然语言回答。
   */
  private async generateAnswer(
    apiKey: string,
    question: string,
    intent: string,
    sql: string,
    rows: Record<string, unknown>[],
    schema: DataAnalyseTableSchema,
  ): Promise<string> {
    const model = this.createChatModel(apiKey, 0.2);
    const result = await model.invoke(
      [
        {
          content: buildDataAnalyseAnswerPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify(
            {
              intent,
              question,
              rowCount: rows.length,
              rows: rows.slice(0, ANSWER_ROWS_LIMIT),
              schema,
              sql,
            },
            null,
            2,
          ),
          role: 'user',
        },
      ],
      this.createDebugRunConfig('data-analyse.answer', {
        rowCount: rows.length,
      }),
    );

    const answer = this.getModelMessage(result).trim();
    if (!answer) {
      return rows.length
        ? `已完成数据查询，共返回 ${rows.length} 行数据。`
        : '查询执行完成，但未返回符合条件的数据。';
    }

    return answer;
  }

  /**
   * 以流式方式调用模型生成最终回答。
   *
   * @param apiKey 模型 API Key。
   * @param question 用户问题。
   * @param intent 识别意图。
   * @param sql 最终 SQL。
   * @param rows 查询结果。
   * @param onChunk 每次收到文本分片时触发的回调。
   * @returns 完整回答文本。
   */
  private async generateAnswerStream(
    apiKey: string,
    question: string,
    intent: string,
    sql: string,
    rows: Record<string, unknown>[],
    onChunk: DataAnalyseAnswerChunkHandler,
    schema: DataAnalyseTableSchema,
  ): Promise<string> {
    const model = this.createChatModel(apiKey, 0.2);
    const answer = await this.streamChatModelAnswer(
      model,
      [
        {
          content: buildDataAnalyseAnswerPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify(
            {
              intent,
              question,
              rowCount: rows.length,
              rows: rows.slice(0, ANSWER_ROWS_LIMIT),
              schema,
              sql,
            },
            null,
            2,
          ),
          role: 'user',
        },
      ],
      onChunk,
      this.createDebugRunConfig('data-analyse.answer.stream', {
        rowCount: rows.length,
      }),
    );

    if (answer.trim()) {
      return answer.trim();
    }

    const fallbackAnswer = rows.length
      ? `已完成数据查询，共返回 ${rows.length} 行数据。`
      : '查询执行完成，但未返回符合条件的数据。';

    await onChunk(fallbackAnswer);
    return fallbackAnswer;
  }

  /**
   * 消费 ChatOpenAI 的流式输出并拼接完整文本。
   *
   * @param model 已配置的聊天模型。
   * @param messages 模型输入消息。
   * @param onChunk 每次收到模型文本分片时触发的回调。
   * @param runConfig LangChain 调试配置。
   * @returns 拼接后的完整文本。
   */
  private async streamChatModelAnswer(
    model: ChatOpenAI,
    messages: Parameters<ChatOpenAI['stream']>[0],
    onChunk: DataAnalyseAnswerChunkHandler,
    runConfig?: ReturnType<typeof createLangChainLocalTraceConfig>,
  ): Promise<string> {
    const stream = await model.stream(messages, runConfig);
    let answer = '';

    for await (const chunk of stream) {
      const text = this.stringifyMessageContent(chunk.content);

      if (!text) {
        continue;
      }

      answer += text;
      await onChunk(text);
    }

    return answer;
  }

  /**
   * 将响应写入消息、产物和 run 完成状态。
   *
   * @param input 持久化上下文。
   */
  private async persistResponse(input: {
    conversationId: string;
    response: DataAnalyseAgentResponse;
    runId: string;
    sql: string | null;
    table: string;
  }): Promise<void> {
    const assistantMessage = await this.agentPersistence.createMessage({
      content: input.response.answer,
      conversationId: input.conversationId,
      metadata: this.toJsonRecord({
        intent: input.response.intent,
        missingParams: input.response.missingParams,
        rowCount: input.response.rowCount,
        sql: input.sql,
        status: input.response.status,
        table: input.table,
      }),
      role: 'assistant',
      runId: input.runId,
    });

    await this.agentPersistence.createArtifact({
      artifactType: 'data_analyse_result',
      conversationId: input.conversationId,
      data: this.toJsonRecord({
        intent: input.response.intent,
        rowCount: input.response.rowCount,
        rowsPreview: input.response.rowsPreview,
        sql: input.sql,
        table: input.table,
      }),
      messageId: assistantMessage.id,
      runId: input.runId,
      title: `data-analyse:${input.table}`,
    });

    await this.agentPersistence.completeRun({
      assistantMessageId: assistantMessage.id,
      output: this.toJsonRecord({
        response: input.response,
      }),
      runId: input.runId,
    });
  }

  /**
   * 持久化失败响应并结束 run。
   *
   * @param conversationId 会话 ID。
   * @param runId 运行 ID。
   * @param response 失败响应。
   */
  private async persistFailedResponse(
    conversationId: string,
    runId: string,
    response: DataAnalyseAgentResponse,
  ): Promise<void> {
    const assistantMessage = await this.agentPersistence.createMessage({
      content: response.answer,
      conversationId,
      metadata: this.toJsonRecord({
        status: response.status,
      }),
      role: 'assistant',
      runId,
      status: 'failed',
    });

    await this.agentPersistence.failRun({
      error: this.toJsonRecord({
        response,
      }),
      runId,
    });

    await this.agentPersistence.updateMessage({
      messageId: assistantMessage.id,
      status: 'failed',
    });
  }

  /**
   * 构建模型调试配置。
   *
   * @param runName 运行名。
   * @param metadata 元数据。
   * @returns 调试配置或 undefined。
   */
  private createDebugRunConfig(
    runName: string,
    metadata: Record<string, unknown>,
  ): ReturnType<typeof createLangChainLocalTraceConfig> {
    return createLangChainLocalTraceConfig({
      metadata: {
        agent: DATA_ANALYSE_AGENT_KEY,
        model: this.getResponseModelName(),
        ...metadata,
      },
      runName,
      tags: ['data-analyse'],
    });
  }

  /**
   * 创建模型实例。
   *
   * @param apiKey 模型 API Key。
   * @param temperature 采样温度。
   * @returns 聊天模型实例。
   */
  private createChatModel(apiKey: string, temperature: number): ChatOpenAI {
    return new ChatOpenAI({
      apiKey,
      configuration: {
        baseURL: OPENAI_COMPATIBLE_BASE_URL,
      },
      model: this.getResponseModelName(),
      temperature,
    });
  }

  /**
   * 获取回答模型名。
   *
   * @returns 模型名。
   */
  private getResponseModelName(): string {
    return process.env.OPENAI_MODEL ?? 'qw-plus';
  }

  /**
   * 确保模型 API Key 已配置。
   *
   * @returns API Key。
   */
  private ensureApiKey(): string {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new BadRequestException(
        '未配置 OPENAI_API_KEY，无法执行数据分析。',
      );
    }

    return apiKey;
  }

  /**
   * 从模型响应读取文本。
   *
   * @param result 模型返回值。
   * @returns 纯文本输出。
   */
  private getModelMessage(result: unknown): string {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);

    if (
      isRecord(result) &&
      'content' in result &&
      typeof result.content === 'string'
    ) {
      return result.content;
    }

    if (
      isRecord(result) &&
      'content' in result &&
      Array.isArray(result.content)
    ) {
      return this.stringifyMessageContent(result.content);
    }

    return '';
  }

  /**
   * 将模型消息 content 转换为纯文本。
   *
   * @param content 模型消息内容。
   * @returns 纯文本内容。
   */
  private stringifyMessageContent(content: unknown): string {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);

    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (isRecord(item)) {
          const text = item.text;
          return typeof text === 'string' ? text : '';
        }

        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 将值转换为可写入 jsonb 的普通对象。
   *
   * @param value 任意值。
   * @returns 标准对象记录。
   */
  private toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
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
