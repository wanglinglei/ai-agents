import { Injectable } from '@nestjs/common';
import { DataAnalyseAnswerService } from './data-analyse-answer.service';
import { DataAnalysePersistenceService } from './data-analyse-persistence.service';
import type {
  DataAnalyseAgentResponse,
  DataAnalyseTableSchema,
} from './types/data-analyse-agent.types';

type DataAnalyseAnswerChunkHandler = (chunk: string) => void | Promise<void>;

/**
 * data-analyse 回答编排服务。
 */
@Injectable()
export class DataAnalyseResponseService {
  constructor(
    private readonly answerService: DataAnalyseAnswerService,
    private readonly persistenceService: DataAnalysePersistenceService,
  ) {}

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
  async generateAnswer(input: {
    apiKey: string;
    question: string;
    intent: string;
    sql: string;
    rows: Record<string, unknown>[];
    schema: DataAnalyseTableSchema;
  }): Promise<string> {
    return this.answerService.generateAnswer(input);
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
  async generateAnswerStream(input: {
    apiKey: string;
    question: string;
    intent: string;
    sql: string;
    rows: Record<string, unknown>[];
    onChunk: DataAnalyseAnswerChunkHandler;
    schema: DataAnalyseTableSchema;
  }): Promise<string> {
    return this.answerService.generateAnswerStream(input);
  }

  /**
   * 将响应写入消息、产物和 run 完成状态。
   *
   * @param input 持久化上下文。
   */
  async persistResponse(input: {
    conversationId: string;
    response: DataAnalyseAgentResponse;
    runId: string;
    sql: string | null;
    table: string;
  }): Promise<void> {
    await this.persistenceService.persistResponse(input);
  }

  /**
   * 持久化失败响应并结束 run。
   *
   * @param conversationId 会话 ID。
   * @param runId 运行 ID。
   * @param response 失败响应。
   */
  async persistFailedResponse(
    conversationId: string,
    runId: string,
    response: DataAnalyseAgentResponse,
  ): Promise<void> {
    await this.persistenceService.persistFailedResponse(
      conversationId,
      runId,
      response,
    );
  }
}
