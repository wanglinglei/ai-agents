import { Injectable } from '@nestjs/common';
import {
  AGENT_ARTIFACT_TYPE,
  AgentRunPersistenceService,
} from '../../common/agents';
import { DataAnalyseModelService } from './data-analyse-model.service';
import type { DataAnalyseAgentResponse } from './types/data-analyse-agent.types';

/**
 * data-analyse 结果持久化服务。
 */
@Injectable()
export class DataAnalysePersistenceService {
  constructor(
    private readonly runPersistence: AgentRunPersistenceService,
    private readonly modelService: DataAnalyseModelService,
  ) {}

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
    await this.runPersistence.persistSuccessfulRun({
      answer: input.response.answer,
      artifact: {
        artifactType: AGENT_ARTIFACT_TYPE.DATA_ANALYSE_RESULT,
        data: this.modelService.toJsonRecord({
          intent: input.response.intent,
          rowCount: input.response.rowCount,
          rowsPreview: input.response.rowsPreview,
          sql: input.sql,
          table: input.table,
        }),
        title: `data-analyse:${input.table}`,
      },
      conversationId: input.conversationId,
      messageMetadata: this.modelService.toJsonRecord({
        intent: input.response.intent,
        missingParams: input.response.missingParams,
        rowCount: input.response.rowCount,
        sql: input.sql,
        status: input.response.status,
        table: input.table,
      }),
      output: this.modelService.toJsonRecord({
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
  async persistFailedResponse(
    conversationId: string,
    runId: string,
    response: DataAnalyseAgentResponse,
  ): Promise<void> {
    await this.runPersistence.persistFailedRun({
      answer: response.answer,
      conversationId,
      error: this.modelService.toJsonRecord({
        response,
      }),
      messageMetadata: this.modelService.toJsonRecord({
        status: response.status,
      }),
      runId,
    });
  }
}
