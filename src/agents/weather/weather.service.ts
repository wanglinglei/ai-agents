import { BadRequestException, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { randomUUID } from 'node:crypto';
import { createAgent } from 'langchain';
import { AgentPersistenceService } from '../persistence/agent-persistence.service';
import {
  createLangChainLocalTraceConfig,
  isLangChainLocalTraceEnabled,
} from '../../common/langchain/langchain-local-trace';
import {
  buildWeatherAgentSystemPrompt,
  buildWeatherAnswerSystemPrompt,
  buildWeatherClarificationSystemPrompt,
} from './prompts/weather-agent.prompt';
import { cityLookupTool } from './tools/city-lookup.tool';
import { weatherTool } from './tools/weather.tool';
import type { WeatherResult } from './tools/weather.tool';
import type {
  WeatherAgentAnswerResult,
  WeatherAgentClarificationResult,
  WeatherAgentResponse,
  WeatherAgentReuseResult,
  WeatherAgentRunResult,
  WeatherAgentStatus,
  WeatherConversationContext,
  WeatherForecastDay,
  WeatherIntent,
  WeatherQueryExecutionContext,
} from './types/weather-agent.types';
import {
  extractJsonObject,
  formatLocalDate,
  getChatModelMessage,
  getFinalAgentMessage,
  hasQWeatherToken,
  stringifyMessageContent,
} from './utils/weather-agent.utils';
import {
  buildApiFailureAnswer,
  buildClarificationResponse,
  buildFailedResponse,
  buildFallbackAnswer,
  buildSuccessResponse,
} from './utils/weather-agent-responses';
import { validateWeatherAgentResult } from './utils/weather-agent-validators';

const OPENAI_COMPATIBLE_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';
const WEATHER_AGENT_KEY = 'weather';
const WEATHER_CONVERSATION_TTL_MS = 10 * 60 * 1000;

type WeatherAnswerChunkHandler = (chunk: string) => void | Promise<void>;

@Injectable()
export class WeatherService {
  constructor(private readonly agentPersistence: AgentPersistenceService) {}

  /**
   * 返回天气 Agent 运行状态。
   *
   * @returns 天气 Agent 配置状态。
   */
  getStatus(): WeatherAgentStatus {
    return {
      hasApiKey: Boolean(process.env.OPENAI_API_KEY),
      integrated: true,
      localTrace: isLangChainLocalTraceEnabled(),
      model: process.env.OPENAI_MODEL || '',
      provider: 'QWeather',
    };
  }

  /**
   * 解析天气请求使用的会话 ID。
   *
   * @param conversationId 调用方传入的可选会话 ID。
   * @returns 已有会话 ID 或新生成的会话 ID。
   */
  private resolveConversationId(conversationId?: string): string {
    return conversationId?.trim() || randomUUID();
  }

  /**
   * 读取未过期的天气会话上下文。
   *
   * @param conversationId 可选会话 ID。
   * @returns 存在且未过期的已存储上下文。
   */
  private async getConversationContext(
    conversationId?: string,
  ): Promise<WeatherConversationContext | undefined> {
    const normalizedConversationId = conversationId?.trim();

    if (!normalizedConversationId) {
      return undefined;
    }

    const context =
      await this.agentPersistence.getConversationState<WeatherConversationContext>(
        WEATHER_AGENT_KEY,
        normalizedConversationId,
      );

    if (!context) {
      return undefined;
    }

    if (typeof context.updatedAt !== 'number') {
      return undefined;
    }

    if (Date.now() - context.updatedAt > WEATHER_CONVERSATION_TTL_MS) {
      return undefined;
    }

    return context;
  }

  /**
   * 存储天气会话上下文，供后续补参或连续查询继承。
   *
   * @param conversationId 要更新的会话 ID。
   * @param context 天气会话上下文。
   */
  private async saveConversationContext(
    conversationId: string,
    context: Omit<WeatherConversationContext, 'updatedAt'>,
  ): Promise<void> {
    await this.agentPersistence.updateConversationState({
      conversationId,
      state: {
        ...context,
        updatedAt: Date.now(),
      },
    });
  }

  /**
   * 生成或复用天气查询会话 ID。
   *
   * @param conversationId 调用方传入的可选会话 ID。
   * @returns 本次请求应使用的会话 ID。
   */
  resolveQueryConversationId(conversationId?: string): string {
    return this.resolveConversationId(conversationId);
  }

  /**
   * 构建包含上一轮上下文的天气 Agent 输入。
   *
   * @param message 当前用户消息。
   * @param context 上一轮天气会话上下文。
   * @returns 供天气 Agent 解析的消息。
   */
  private buildContextualWeatherMessage(
    message: string,
    context: WeatherConversationContext | undefined,
  ): string {
    if (!context) {
      return message;
    }

    return JSON.stringify(
      {
        currentMessage: message,
        lastDemand: context.lastDemand,
        lastIntent: context.lastIntent,
        lastQuestion: context.lastQuestion,
        lastWeatherSummary: this.buildWeatherContextSummary(
          context.lastWeather,
          context.lastIntent,
        ),
        missingParams: context.missingParams,
        pendingIntent: context.partialIntent,
      },
      null,
      2,
    );
  }

  /**
   * 构建用于多轮意图合并的最近天气摘要，避免把完整天气结果塞回模型。
   *
   * @param weather 最近一次成功查询的天气结果。
   * @param intent 最近一次完整天气意图。
   * @returns 可读的天气摘要。
   */
  private buildWeatherContextSummary(
    weather: WeatherResult | undefined,
    intent: WeatherIntent | undefined,
  ): Record<string, unknown> | undefined {
    if (!weather || !intent) {
      return undefined;
    }

    const forecast = this.findForecastByDate(weather, intent.date);

    return {
      city: weather.city,
      current: weather.current,
      forecast,
      queryDate: weather.queryDate,
      queryType: weather.queryType,
      resolvedCity: weather.resolvedCity,
      source: weather.source,
    };
  }

  /**
   * 查询天气数据并生成面向用户的简洁回答。
   *
   * @param message 自然语言天气请求。
   * @param conversationId 多轮上下文使用的可选会话 ID。
   * @returns 天气数据和生成的回答。
   */
  async query(
    message: string,
    conversationId?: string,
  ): Promise<WeatherAgentResponse> {
    const normalizedQuestion = message.trim();

    if (!normalizedQuestion) {
      throw new BadRequestException('请提供天气查询内容。');
    }

    const activeConversationId = this.resolveConversationId(conversationId);

    return this.queryByMessage(normalizedQuestion, activeConversationId);
  }

  /**
   * 查询天气并以模型生成片段形式回调最终回答文本。
   *
   * @param message 自然语言天气请求。
   * @param conversationId 多轮上下文使用的可选会话 ID。
   * @param onAnswerChunk 每次收到回答文本片段时触发的回调。
   * @returns 天气数据和完整回答。
   */
  async streamQuery(
    message: string,
    conversationId: string | undefined,
    onAnswerChunk: WeatherAnswerChunkHandler,
  ): Promise<WeatherAgentResponse> {
    const normalizedQuestion = message.trim();

    if (!normalizedQuestion) {
      throw new BadRequestException('请提供天气查询内容。');
    }

    const activeConversationId = this.resolveConversationId(conversationId);

    return this.queryByMessage(
      normalizedQuestion,
      activeConversationId,
      onAnswerChunk,
    );
  }

  /**
   * 在查询天气数据前解析自然语言天气请求。
   *
   * @param message 用户自然语言请求。
   * @returns 天气 Agent 响应。
   */
  private async queryByMessage(
    message: string,
    conversationId: string,
    onAnswerChunk?: WeatherAnswerChunkHandler,
  ): Promise<WeatherAgentResponse> {
    await this.agentPersistence.ensureConversation({
      agentKey: WEATHER_AGENT_KEY,
      conversationId,
      title: message.slice(0, 80),
    });

    const context = await this.buildQueryExecutionContext(
      message,
      conversationId,
      this.getRequiredOpenAIApiKey(),
    );
    const userMessage = await this.agentPersistence.createMessage({
      content: message,
      conversationId,
      role: 'user',
    });
    const run = await this.agentPersistence.createRun({
      agentKey: WEATHER_AGENT_KEY,
      conversationId,
      input: {
        agentMessage: context.agentMessage,
        conversationContext: context.conversationContext,
        message,
      },
      model: this.getResponseModelName(),
      provider: 'QWeather',
      userMessageId: userMessage.id,
    });

    try {
      const agentResult = await this.runWeatherAgent(
        context.agentMessage,
        context.apiKey,
      );

      if (agentResult.action === 'clarify') {
        const response = await this.handleClarificationResult(
          message,
          context,
          agentResult,
          onAnswerChunk,
        );

        await this.persistWeatherResponse(response, run.id);

        return response;
      }

      if (agentResult.action === 'reuse') {
        const response = await this.handleReuseResult(
          message,
          context,
          agentResult,
          onAnswerChunk,
        );

        await this.persistWeatherResponse(response, run.id);

        return response;
      }

      const response = await this.handleAnswerResult(
        message,
        context,
        agentResult,
        onAnswerChunk,
      );

      await this.persistWeatherResponse(response, run.id);

      return response;
    } catch (error) {
      const response = buildFailedResponse({
        answer: buildApiFailureAnswer(message, error),
        conversationId,
        message,
        model: this.getResponseModelName(),
      });

      await this.persistWeatherResponse(response, run.id, false);
      await this.agentPersistence.failRun({
        error: this.serializeError(error),
        runId: run.id,
      });

      return response;
    }
  }

  /**
   * 读取必需的 OpenAI 兼容 API Key，并校验和风天气 token。
   *
   * @returns OpenAI 兼容 API Key。
   */
  private getRequiredOpenAIApiKey(): string {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new BadRequestException(
        'OPENAI_API_KEY is required to parse natural language weather requests.',
      );
    }

    if (!hasQWeatherToken()) {
      throw new BadRequestException(
        'QWeather token is required. Set WEATHER_API_TOKEN.',
      );
    }

    return apiKey;
  }

  /**
   * 构建执行天气查询所需的派生上下文。
   *
   * @param message 用户自然语言请求。
   * @param conversationId 多轮上下文使用的可选会话 ID。
   * @param apiKey OpenAI 兼容 API Key。
   * @returns 准备好的查询执行上下文。
   */
  private async buildQueryExecutionContext(
    message: string,
    conversationId: string | undefined,
    apiKey: string,
  ): Promise<WeatherQueryExecutionContext> {
    const normalizedConversationId = conversationId?.trim();
    const conversationContext = await this.getConversationContext(
      normalizedConversationId,
    );
    const agentMessage = this.buildContextualWeatherMessage(
      message,
      conversationContext,
    );
    const originalDemandMessage = this.buildDemandMessage(
      message,
      conversationContext,
    );

    return {
      agentMessage,
      apiKey,
      conversationContext,
      normalizedConversationId,
      originalDemandMessage,
    };
  }

  /**
   * 构建用于回答生成的需求描述，保留最近会话意图和本轮用户输入。
   *
   * @param message 本轮用户消息。
   * @param context 已存在的天气会话上下文。
   * @returns 面向回答模型的用户需求描述。
   */
  private buildDemandMessage(
    message: string,
    context: WeatherConversationContext | undefined,
  ): string {
    if (!context) {
      return message;
    }

    return [
      `最近用户问题：${context.lastQuestion}`,
      `最近完整意图：${JSON.stringify(context.lastIntent ?? {})}`,
      `最近需求：${context.lastDemand || '无'}`,
      `待补齐意图：${JSON.stringify(context.partialIntent)}`,
      `本轮用户输入：${message}`,
    ].join('\n');
  }

  /**
   * 处理 Agent 追问结果，并存储下一轮需要的上下文。
   *
   * @param message 当前用户消息。
   * @param context 准备好的查询执行上下文。
   * @param agentResult 已解析的追问结果。
   * @returns 要求用户补充信息的天气响应。
   */
  private async handleClarificationResult(
    message: string,
    context: WeatherQueryExecutionContext,
    agentResult: WeatherAgentClarificationResult,
    onAnswerChunk?: WeatherAnswerChunkHandler,
  ): Promise<WeatherAgentResponse> {
    const activeConversationId = this.resolveConversationId(
      context.normalizedConversationId,
    );
    const partialIntent = {
      ...context.conversationContext?.partialIntent,
      ...agentResult.intent,
    };
    const lastDemand =
      partialIntent.demand || context.conversationContext?.lastDemand;
    const answer = onAnswerChunk
      ? await this.generateClarificationAnswerStream(
          context.originalDemandMessage,
          context.apiKey,
          partialIntent,
          agentResult.missingParams,
          agentResult.answer,
          onAnswerChunk,
        )
      : await this.generateClarificationAnswer(
          context.originalDemandMessage,
          context.apiKey,
          partialIntent,
          agentResult.missingParams,
          agentResult.answer,
        );

    await this.saveConversationContext(activeConversationId, {
      lastDemand,
      lastIntent: context.conversationContext?.lastIntent,
      lastQuestion: context.conversationContext?.missingParams.length
        ? context.conversationContext.lastQuestion
        : message,
      lastWeather: context.conversationContext?.lastWeather,
      missingParams: agentResult.missingParams,
      partialIntent,
    });

    return buildClarificationResponse({
      answer,
      conversationId: activeConversationId,
      message,
      missingParams: agentResult.missingParams,
      model: this.getResponseModelName(),
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
  private async handleAnswerResult(
    message: string,
    context: WeatherQueryExecutionContext,
    agentResult: WeatherAgentAnswerResult,
    onAnswerChunk?: WeatherAnswerChunkHandler,
  ): Promise<WeatherAgentResponse> {
    const intent = agentResult.intent;
    const weather = agentResult.weather;
    const activeConversationId = this.resolveConversationId(
      context.normalizedConversationId,
    );
    const lastDemand = intent.demand || context.conversationContext?.lastDemand;
    const forecast = this.findForecastByDate(weather, intent.date);
    let answer = onAnswerChunk
      ? await this.generateDemandAwareAnswerStream(
          context.originalDemandMessage,
          context.apiKey,
          intent,
          weather,
          forecast,
          agentResult.answer,
          onAnswerChunk,
        )
      : await this.generateDemandAwareAnswer(
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

    await this.saveConversationContext(activeConversationId, {
      lastDemand,
      lastIntent: { ...intent, ...(lastDemand ? { demand: lastDemand } : {}) },
      lastQuestion: context.conversationContext?.missingParams.length
        ? `${context.conversationContext.lastQuestion}；用户补充：${message}`
        : message,
      lastWeather: weather,
      missingParams: [],
      partialIntent: {},
    });

    return buildSuccessResponse({
      answer,
      conversationId: activeConversationId,
      intent,
      message,
      model: this.getResponseModelName(),
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
  private async handleReuseResult(
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
    const activeConversationId = this.resolveConversationId(
      context.normalizedConversationId,
    );
    const lastDemand = intent.demand || previousContext.lastDemand;
    const normalizedIntent = {
      ...intent,
      ...(lastDemand ? { demand: lastDemand } : {}),
    };
    const forecast = this.findForecastByDate(weather, normalizedIntent.date);
    let answer = onAnswerChunk
      ? await this.generateDemandAwareAnswerStream(
          context.originalDemandMessage,
          context.apiKey,
          normalizedIntent,
          weather,
          forecast,
          agentResult.answer,
          onAnswerChunk,
        )
      : await this.generateDemandAwareAnswer(
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

    await this.saveConversationContext(activeConversationId, {
      lastDemand,
      lastIntent: normalizedIntent,
      lastQuestion: message,
      lastWeather: weather,
      missingParams: [],
      partialIntent: {},
    });

    return buildSuccessResponse({
      answer,
      conversationId: activeConversationId,
      intent: normalizedIntent,
      message,
      model: this.getResponseModelName(),
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
  private async persistWeatherResponse(
    response: WeatherAgentResponse,
    runId: string,
    completeRun = true,
  ): Promise<void> {
    if (!response.conversationId) {
      return;
    }

    const assistantMessage = await this.agentPersistence.createMessage({
      content: response.answer,
      conversationId: response.conversationId,
      metadata: {
        city: response.city,
        date: response.date,
        dateText: response.dateText,
        intent: response.intent,
        missingParams: response.missingParams,
        model: response.model,
        partialIntent: response.partialIntent,
        status: response.status,
      },
      role: 'assistant',
      runId,
      status: response.status === 'failed' ? 'failed' : 'completed',
    });

    const artifact = response.weather
      ? await this.agentPersistence.createArtifact({
          artifactType: 'weather_result',
          conversationId: response.conversationId,
          data: this.toJsonRecord(response.weather),
          messageId: assistantMessage.id,
          metadata: {
            city: response.city,
            date: response.date,
            intent: response.intent,
            source: response.weather.source,
          },
          runId,
          title: `${response.city ?? '未知城市'}${response.dateText ?? ''}天气结果`,
        })
      : undefined;

    if (artifact) {
      await this.agentPersistence.updateMessage({
        messageId: assistantMessage.id,
        metadata: {
          ...assistantMessage.metadata,
          weatherArtifactId: artifact.id,
        },
      });
    }

    if (completeRun) {
      await this.agentPersistence.completeRun({
        assistantMessageId: assistantMessage.id,
        output: {
          answer: response.answer,
          artifactId: artifact?.id,
          intent: response.intent,
          missingParams: response.missingParams,
          partialIntent: response.partialIntent,
          status: response.status,
        },
        runId,
      });
    }
  }

  /**
   * 将未知错误转换为可安全写入 jsonb 的对象。
   *
   * @param error 捕获到的未知错误。
   * @returns 标准化错误对象。
   */
  private serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    }

    return {
      message: String(error),
    };
  }

  /**
   * 将结构化对象转换为普通 JSON 记录，便于写入 jsonb。
   *
   * @param value 要转换的值。
   * @returns 可写入 jsonb 的普通对象。
   */
  private toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }

  /**
   * 读取天气响应中暴露的模型名称。
   *
   * @returns 已配置的模型名称，或现有兜底模型名称。
   */
  private getResponseModelName(): string {
    return process.env.OPENAI_MODEL ?? 'qw-plus';
  }

  /**
   * 构建天气 Agent 调试运行配置。
   *
   * @param runName 本次运行名称。
   * @param metadata 附加到本次运行的业务元数据。
   * @returns 启用本地日志时返回 runnable 配置，否则返回 undefined。
   */
  private createWeatherDebugRunConfig(
    runName: string,
    metadata: Record<string, unknown> = {},
  ): ReturnType<typeof createLangChainLocalTraceConfig> {
    return createLangChainLocalTraceConfig({
      metadata: {
        agent: WEATHER_AGENT_KEY,
        model: this.getResponseModelName(),
        ...metadata,
      },
      runName,
      tags: ['weather'],
    });
  }

  /**
   * 创建面向 DashScope 的 OpenAI 兼容聊天模型。
   *
   * @param apiKey OpenAI 兼容 API Key。
   * @param temperature 模型采样温度。
   * @returns 配置完成的聊天模型。
   */
  private createChatModel(apiKey: string, temperature: number): ChatOpenAI {
    return new ChatOpenAI({
      apiKey,
      model: this.getResponseModelName(),
      temperature,
      configuration: {
        baseURL: OPENAI_COMPATIBLE_BASE_URL,
      },
    });
  }

  /**
   * 针对自然语言请求运行工具调用型天气 Agent。
   *
   * @param message 自然语言天气请求。
   * @param apiKey OpenAI API Key。
   * @returns 已解析的意图、天气数据和最终回答。
   */
  private async runWeatherAgent(
    message: string,
    apiKey: string,
  ): Promise<WeatherAgentRunResult> {
    const today = formatLocalDate(new Date());
    const agent = createAgent({
      model: this.createChatModel(apiKey, 0),
      systemPrompt: buildWeatherAgentSystemPrompt(today),
      tools: [cityLookupTool, weatherTool],
    });
    const result = await agent.invoke(
      {
        messages: [
          {
            content: `用户输入：${message}`,
            role: 'user',
          },
        ],
      },
      this.createWeatherDebugRunConfig('weather.agent.invoke', {
        phase: 'intent-and-tool',
      }),
    );
    const output = getFinalAgentMessage(result);

    if (!output) {
      throw new BadRequestException(
        'Weather agent returned an empty response.',
      );
    }

    return validateWeatherAgentResult(JSON.parse(extractJsonObject(output)));
  }

  /**
   * 查找目标日期对应的服务商预报数据。
   *
   * @param weather 标准化后的天气结果。
   * @param date YYYY-MM-DD 格式的目标日期。
   * @returns 可用时返回目标日期的预报数据。
   */
  private findForecastByDate(
    weather: WeatherResult,
    date: string,
  ): WeatherForecastDay | undefined {
    return weather.forecast.find((forecast) => forecast.date === date);
  }

  /**
   * 根据用户需求和缺失信息生成自然追问回答。
   *
   * @param message 用户原始问题。
   * @param apiKey OpenAI 兼容 API Key。
   * @param intent 已解析的部分天气意图。
   * @param missingParams 缺失的天气查询参数。
   * @param agentAnswer 工具调用型 Agent 生成的追问草稿。
   * @returns 自然语言追问回答。
   */
  private async generateClarificationAnswer(
    message: string,
    apiKey: string,
    intent: Partial<WeatherIntent>,
    missingParams: string[],
    agentAnswer: string,
  ): Promise<string> {
    const model = this.createChatModel(apiKey, 0.3);
    const result = await model.invoke(
      [
        {
          content: buildWeatherClarificationSystemPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify({
            agentAnswer,
            intent,
            missingParams,
            userQuestion: message,
          }),
          role: 'user',
        },
      ],
      this.createWeatherDebugRunConfig('weather.clarification.invoke', {
        missingParams,
        phase: 'clarification',
      }),
    );

    return getChatModelMessage(result) || agentAnswer;
  }

  /**
   * 以流式方式生成自然追问回答。
   *
   * @param message 用户原始问题。
   * @param apiKey OpenAI 兼容 API Key。
   * @param intent 已解析的部分天气意图。
   * @param missingParams 缺失的天气查询参数。
   * @param agentAnswer 工具调用型 Agent 生成的追问草稿。
   * @param onChunk 每次收到模型文本片段时触发的回调。
   * @returns 完整自然语言追问回答。
   */
  private async generateClarificationAnswerStream(
    message: string,
    apiKey: string,
    intent: Partial<WeatherIntent>,
    missingParams: string[],
    agentAnswer: string,
    onChunk: WeatherAnswerChunkHandler,
  ): Promise<string> {
    const model = this.createChatModel(apiKey, 0.3);
    const answer = await this.streamChatModelAnswer(
      model,
      [
        {
          content: buildWeatherClarificationSystemPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify({
            agentAnswer,
            intent,
            missingParams,
            userQuestion: message,
          }),
          role: 'user',
        },
      ],
      onChunk,
      this.createWeatherDebugRunConfig('weather.clarification.stream', {
        missingParams,
        phase: 'clarification',
      }),
    );

    if (answer) {
      return answer;
    }

    await onChunk(agentAnswer);
    return agentAnswer;
  }

  /**
   * 根据用户请求和天气数据生成贴合需求的回答。
   *
   * @param message 用户原始问题。
   * @param apiKey OpenAI 兼容 API Key。
   * @param intent 已解析的天气意图。
   * @param weather 标准化后的天气结果。
   * @param forecast 请求日期对应的预报数据。
   * @param agentAnswer 工具调用型 Agent 生成的回答草稿。
   * @returns 贴合用户需求的自然语言回答。
   */
  private async generateDemandAwareAnswer(
    message: string,
    apiKey: string,
    intent: WeatherIntent,
    weather: WeatherResult,
    forecast: WeatherForecastDay | undefined,
    agentAnswer: string,
  ): Promise<string> {
    const model = this.createChatModel(apiKey, 0.3);
    const result = await model.invoke(
      [
        {
          content: buildWeatherAnswerSystemPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify({
            agentAnswer,
            forecast,
            intent,
            userQuestion: message,
            weather,
          }),
          role: 'user',
        },
      ],
      this.createWeatherDebugRunConfig('weather.answer.invoke', {
        city: intent.city,
        date: intent.date,
        phase: 'answer',
      }),
    );

    return getChatModelMessage(result);
  }

  /**
   * 以流式方式根据用户请求和天气数据生成贴合需求的回答。
   *
   * @param message 用户原始问题。
   * @param apiKey OpenAI 兼容 API Key。
   * @param intent 已解析的天气意图。
   * @param weather 标准化后的天气结果。
   * @param forecast 请求日期对应的预报数据。
   * @param agentAnswer 工具调用型 Agent 生成的回答草稿。
   * @param onChunk 每次收到模型文本片段时触发的回调。
   * @returns 完整自然语言回答。
   */
  private async generateDemandAwareAnswerStream(
    message: string,
    apiKey: string,
    intent: WeatherIntent,
    weather: WeatherResult,
    forecast: WeatherForecastDay | undefined,
    agentAnswer: string,
    onChunk: WeatherAnswerChunkHandler,
  ): Promise<string> {
    const model = this.createChatModel(apiKey, 0.3);

    return this.streamChatModelAnswer(
      model,
      [
        {
          content: buildWeatherAnswerSystemPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify({
            agentAnswer,
            forecast,
            intent,
            userQuestion: message,
            weather,
          }),
          role: 'user',
        },
      ],
      onChunk,
      this.createWeatherDebugRunConfig('weather.answer.stream', {
        city: intent.city,
        date: intent.date,
        phase: 'answer',
      }),
    );
  }

  /**
   * 消费 ChatOpenAI 的流式输出并拼接完整文本。
   *
   * @param model 已配置的聊天模型。
   * @param messages 模型输入消息。
   * @param onChunk 每次收到模型文本片段时触发的回调。
   * @param runConfig LangChain 调试配置。
   * @returns 拼接后的完整文本。
   */
  private async streamChatModelAnswer(
    model: ChatOpenAI,
    messages: Parameters<ChatOpenAI['stream']>[0],
    onChunk: WeatherAnswerChunkHandler,
    runConfig?: ReturnType<typeof createLangChainLocalTraceConfig>,
  ): Promise<string> {
    const stream = await model.stream(messages, runConfig);
    let answer = '';

    for await (const chunk of stream) {
      const text = stringifyMessageContent(chunk.content);

      if (!text) {
        continue;
      }

      answer += text;
      await onChunk(text);
    }

    return answer.trim();
  }
}
