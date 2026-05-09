import { Injectable } from '@nestjs/common';
import type { StreamChunkHandler } from '../../common/langchain';
import { StreamAnswerService } from '../../common/langchain';
import { buildDataAnalyseAnswerPrompt } from './prompts/data-analyse-agent.prompt';
import { DataAnalyseModelService } from './data-analyse-model.service';
import type { DataAnalyseTableSchema } from './types/data-analyse-agent.types';

const ANSWER_ROWS_LIMIT = 50;

type DataAnalyseAnswerChunkHandler = StreamChunkHandler;

/**
 * data-analyse 回答生成服务。
 */
@Injectable()
export class DataAnalyseAnswerService {
  constructor(
    private readonly modelService: DataAnalyseModelService,
    private readonly streamAnswerService: StreamAnswerService,
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
    const model = this.modelService.createChatModel(input.apiKey, 0.2);
    const result = await model.invoke(
      [
        {
          content: buildDataAnalyseAnswerPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify(
            {
              intent: input.intent,
              question: input.question,
              rowCount: input.rows.length,
              rows: input.rows.slice(0, ANSWER_ROWS_LIMIT),
              schema: input.schema,
              sql: input.sql,
            },
            null,
            2,
          ),
          role: 'user',
        },
      ],
      this.modelService.createDebugRunConfig('data-analyse.answer', {
        rowCount: input.rows.length,
      }),
    );

    const answer = this.modelService.getModelMessage(result).trim();
    if (!answer) {
      return input.rows.length
        ? `已完成数据查询，共返回 ${input.rows.length} 行数据。`
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
  async generateAnswerStream(input: {
    apiKey: string;
    question: string;
    intent: string;
    sql: string;
    rows: Record<string, unknown>[];
    onChunk: DataAnalyseAnswerChunkHandler;
    schema: DataAnalyseTableSchema;
  }): Promise<string> {
    const model = this.modelService.createChatModel(input.apiKey, 0.2);
    const answer = await this.streamAnswerService.streamAndCollect({
      extractText: (chunkContent) =>
        this.modelService.stringifyMessageContent(chunkContent),
      messages: [
        {
          content: buildDataAnalyseAnswerPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify(
            {
              intent: input.intent,
              question: input.question,
              rowCount: input.rows.length,
              rows: input.rows.slice(0, ANSWER_ROWS_LIMIT),
              schema: input.schema,
              sql: input.sql,
            },
            null,
            2,
          ),
          role: 'user',
        },
      ],
      model,
      onChunk: input.onChunk,
      runConfig: this.modelService.createDebugRunConfig(
        'data-analyse.answer.stream',
        {
          rowCount: input.rows.length,
        },
      ),
    });

    if (answer.trim()) {
      return answer.trim();
    }

    const fallbackAnswer = input.rows.length
      ? `已完成数据查询，共返回 ${input.rows.length} 行数据。`
      : '查询执行完成，但未返回符合条件的数据。';

    await input.onChunk(fallbackAnswer);
    return fallbackAnswer;
  }
}
