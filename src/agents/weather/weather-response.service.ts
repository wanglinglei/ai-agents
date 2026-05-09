import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  WeatherAgentAnswerResult,
  WeatherAgentClarificationResult,
  WeatherAgentResponse,
  WeatherAgentReuseResult,
  WeatherQueryExecutionContext,
} from './types/weather-agent.types';
import {
  buildClarificationResponse,
  buildFallbackAnswer,
  buildSuccessResponse,
} from './utils/weather-agent-responses';
import { WeatherAnswerService } from './weather-answer.service';
import { WeatherConversationService } from './weather-conversation.service';
import { WeatherModelService } from './weather-model.service';
import { WeatherPersistenceService } from './weather-persistence.service';

type WeatherAnswerChunkHandler = (chunk: string) => void | Promise<void>;

/**
 * weather 回答分支编排服务。
 */
@Injectable()
export class WeatherResponseService {
  constructor(
    private readonly answerService: WeatherAnswerService,
    private readonly conversationService: WeatherConversationService,
    private readonly weatherModelService: WeatherModelService,
    private readonly persistenceService: WeatherPersistenceService,
  ) {}

  /**
   * 处理 Agent 追问结果，并存储下一轮需要的上下文。
   *
   * @param message 当前用户消息。
   * @param context 准备好的查询执行上下文。
   * @param agentResult 已解析的追问结果。
   * @returns 要求用户补充信息的天气响应。
   */
  async handleClarificationResult(
    message: string,
    context: WeatherQueryExecutionContext,
    agentResult: WeatherAgentClarificationResult,
    onAnswerChunk?: WeatherAnswerChunkHandler,
  ): Promise<WeatherAgentResponse> {
    const activeConversationId = this.conversationService.resolveConversationId(
      context.normalizedConversationId,
    );
    const partialIntent = {
      ...context.conversationContext?.partialIntent,
      ...agentResult.intent,
    };
    const lastDemand =
      partialIntent.demand || context.conversationContext?.lastDemand;
    const answer = onAnswerChunk
      ? await this.answerService.generateClarificationAnswerStream(
          context.originalDemandMessage,
          context.apiKey,
          partialIntent,
          agentResult.missingParams,
          agentResult.answer,
          onAnswerChunk,
        )
      : await this.answerService.generateClarificationAnswer(
          context.originalDemandMessage,
          context.apiKey,
          partialIntent,
          agentResult.missingParams,
          agentResult.answer,
        );

    await this.conversationService.saveConversationContext(
      activeConversationId,
      {
        lastDemand,
        lastIntent: context.conversationContext?.lastIntent,
        lastQuestion: context.conversationContext?.missingParams.length
          ? context.conversationContext.lastQuestion
          : message,
        lastWeather: context.conversationContext?.lastWeather,
        missingParams: agentResult.missingParams,
        partialIntent,
      },
    );

    return buildClarificationResponse({
      answer,
      conversationId: activeConversationId,
      message,
      missingParams: agentResult.missingParams,
      model: this.weatherModelService.getResponseModelName(),
      partialIntent,
    });
  }

  /**
   * 处理完整天气查询结果，并保存最近完整意图供同会话后续继承。
   *
   * @param message 当前用户消息。
   * @param context 准备好的查询执行上下文。
   * @param agentResult 已解析的天气回答结果。
   * @returns 包含回答和结构化天气数据的天气响应。
   */
  async handleAnswerResult(
    message: string,
    context: WeatherQueryExecutionContext,
    agentResult: WeatherAgentAnswerResult,
    onAnswerChunk?: WeatherAnswerChunkHandler,
  ): Promise<WeatherAgentResponse> {
    const intent = agentResult.intent;
    const weather = agentResult.weather;
    const activeConversationId = this.conversationService.resolveConversationId(
      context.normalizedConversationId,
    );
    const lastDemand = intent.demand || context.conversationContext?.lastDemand;
    const forecast = this.conversationService.findForecastByDate(
      weather,
      intent.date,
    );
    let answer = onAnswerChunk
      ? await this.answerService.generateDemandAwareAnswerStream(
          context.originalDemandMessage,
          context.apiKey,
          intent,
          weather,
          forecast,
          agentResult.answer,
          onAnswerChunk,
        )
      : await this.answerService.generateDemandAwareAnswer(
          context.originalDemandMessage,
          context.apiKey,
          intent,
          weather,
          forecast,
          agentResult.answer,
        );

    if (!answer) {
      answer = buildFallbackAnswer(weather, intent, forecast);
      await onAnswerChunk?.(answer);
    }

    await this.conversationService.saveConversationContext(
      activeConversationId,
      {
        lastDemand,
        lastIntent: {
          ...intent,
          ...(lastDemand ? { demand: lastDemand } : {}),
        },
        lastQuestion: context.conversationContext?.missingParams.length
          ? `${context.conversationContext.lastQuestion}；用户补充：${message}`
          : message,
        lastWeather: weather,
        missingParams: [],
        partialIntent: {},
      },
    );

    return buildSuccessResponse({
      answer,
      conversationId: activeConversationId,
      intent,
      message,
      model: this.weatherModelService.getResponseModelName(),
      weather,
    });
  }

  /**
   * 处理仅变更生活需求的结果，复用最近一次天气数据生成回答。
   *
   * @param message 当前用户消息。
   * @param context 准备好的查询执行上下文。
   * @param agentResult 已解析的复用天气结果。
   * @returns 包含复用天气数据和新回答的天气响应。
   */
  async handleReuseResult(
    message: string,
    context: WeatherQueryExecutionContext,
    agentResult: WeatherAgentReuseResult,
    onAnswerChunk?: WeatherAnswerChunkHandler,
  ): Promise<WeatherAgentResponse> {
    const previousContext = context.conversationContext;

    if (!previousContext?.lastWeather) {
      throw new BadRequestException(
        'No previous weather result can be reused.',
      );
    }

    const intent = agentResult.intent;
    const previousIntent = previousContext.lastIntent;

    if (
      !previousIntent ||
      previousIntent.city !== intent.city ||
      previousIntent.date !== intent.date
    ) {
      throw new BadRequestException(
        'Reusable weather context does not match requested intent.',
      );
    }

    const weather = previousContext.lastWeather;
    const activeConversationId = this.conversationService.resolveConversationId(
      context.normalizedConversationId,
    );
    const lastDemand = intent.demand || previousContext.lastDemand;
    const normalizedIntent = {
      ...intent,
      ...(lastDemand ? { demand: lastDemand } : {}),
    };
    const forecast = this.conversationService.findForecastByDate(
      weather,
      normalizedIntent.date,
    );
    let answer = onAnswerChunk
      ? await this.answerService.generateDemandAwareAnswerStream(
          context.originalDemandMessage,
          context.apiKey,
          normalizedIntent,
          weather,
          forecast,
          agentResult.answer,
          onAnswerChunk,
        )
      : await this.answerService.generateDemandAwareAnswer(
          context.originalDemandMessage,
          context.apiKey,
          normalizedIntent,
          weather,
          forecast,
          agentResult.answer,
        );

    if (!answer) {
      answer = buildFallbackAnswer(weather, normalizedIntent, forecast);
      await onAnswerChunk?.(answer);
    }

    await this.conversationService.saveConversationContext(
      activeConversationId,
      {
        lastDemand,
        lastIntent: normalizedIntent,
        lastQuestion: message,
        lastWeather: weather,
        missingParams: [],
        partialIntent: {},
      },
    );

    return buildSuccessResponse({
      answer,
      conversationId: activeConversationId,
      intent: normalizedIntent,
      message,
      model: this.weatherModelService.getResponseModelName(),
      weather,
    });
  }

  /**
   * 保存天气响应对应的助手消息、天气产物和运行结果。
   *
   * @param response 天气 Agent 对外响应。
   * @param runId 本次 Agent 运行 ID。
   * @param completeRun 是否将运行标记为完成。
   */
  async persistWeatherResponse(
    response: WeatherAgentResponse,
    runId: string,
    completeRun = true,
  ): Promise<void> {
    await this.persistenceService.persistWeatherResponse(
      response,
      runId,
      completeRun,
    );
  }
}
