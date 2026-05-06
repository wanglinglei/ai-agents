import { BadRequestException, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { randomUUID } from 'node:crypto';
import { createAgent } from 'langchain';
import {
  buildWeatherAgentSystemPrompt,
  buildWeatherAnswerSystemPrompt,
  buildWeatherClarificationSystemPrompt,
} from './prompts/weather-agent.prompt';
import { cityLookupTool } from './tools/city-lookup.tool';
import { weatherTool } from './tools/weather.tool';
import type { WeatherResult } from './tools/weather.tool';

export interface WeatherIntent {
  city: string;
  date: string;
  dateText: string;
}

export type WeatherAgentResponseStatus =
  | 'failed'
  | 'need_clarification'
  | 'success';

export interface WeatherAgentStatus {
  hasApiKey: boolean;
  integrated: boolean;
  model: string;
  provider: string;
}

export interface WeatherAgentResponse {
  answer: string;
  city?: string;
  conversationId?: string;
  date?: string;
  dateText?: string;
  intent?: WeatherIntent;
  missingParams?: string[];
  model: string | null;
  partialIntent?: Partial<WeatherIntent>;
  question: string;
  status: WeatherAgentResponseStatus;
  weather?: WeatherResult;
}

interface WeatherConversationContext {
  lastQuestion: string;
  missingParams: string[];
  partialIntent: Partial<WeatherIntent>;
  updatedAt: number;
}

type WeatherForecastDay = WeatherResult['forecast'][number];
type WeatherAgentRunResult =
  | {
      action: 'answer';
      answer: string;
      intent: WeatherIntent;
      weather: WeatherResult;
    }
  | {
      action: 'clarify';
      answer: string;
      intent: Partial<WeatherIntent>;
      missingParams: string[];
    };
type WeatherAgentAnswerResult = Extract<
  WeatherAgentRunResult,
  { action: 'answer' }
>;
type WeatherAgentClarificationResult = Extract<
  WeatherAgentRunResult,
  { action: 'clarify' }
>;

interface WeatherQueryExecutionContext {
  agentMessage: string;
  apiKey: string;
  conversationContext: WeatherConversationContext | undefined;
  normalizedConversationId: string | undefined;
  originalDemandMessage: string;
}

const OPENAI_COMPATIBLE_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';
const WEATHER_CONVERSATION_TTL_MS = 10 * 60 * 1000;

/**
 * 判断传入值是否为普通对象记录。
 *
 * @param value 要检查的值。
 * @returns 当该值可以按对象记录读取时返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从对象记录中读取字符串值。
 *
 * @param record 来源对象记录。
 * @param key 要读取的属性名。
 * @returns 字符串值，不存在时返回空字符串。
 */
function getStringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 从对象记录中读取字符串数组。
 *
 * @param record 来源对象记录。
 * @param key 要读取的属性名。
 * @returns 字符串数组，不存在时返回空数组。
 */
function getStringArrayValue(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * 从模型输出中提取 JSON 对象字符串。
 *
 * @param output 原始模型输出。
 * @returns JSON 对象字符串。
 */
function extractJsonObject(output: string): string {
  const normalizedOutput = output
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const startIndex = normalizedOutput.indexOf('{');
  const endIndex = normalizedOutput.lastIndexOf('}');

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new BadRequestException('Failed to parse weather intent.');
  }

  return normalizedOutput.slice(startIndex, endIndex + 1);
}

/**
 * 将 LangChain 消息内容转换为纯文本。
 *
 * @param value 消息内容值。
 * @returns 纯文本内容。
 */
function stringifyMessageContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }

      if (isRecord(item)) {
        return getStringValue(item, 'text');
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * 从 LangChain Agent 结果中读取最终助手消息文本。
 *
 * @param result Agent 调用结果。
 * @returns 最终助手消息内容。
 */
function getFinalAgentMessage(result: unknown): string {
  if (!isRecord(result)) {
    return '';
  }

  const output = result.output;

  if (typeof output === 'string') {
    return output;
  }

  const messages: unknown = result.messages;

  if (!Array.isArray(messages)) {
    return '';
  }

  const lastMessage: unknown = messages[messages.length - 1];

  if (!isRecord(lastMessage)) {
    return '';
  }

  return stringifyMessageContent(lastMessage.content);
}

/**
 * 从聊天模型结果中读取纯文本内容。
 *
 * @param result 聊天模型调用结果。
 * @returns 纯文本模型输出。
 */
function getChatModelMessage(result: unknown): string {
  if (!isRecord(result)) {
    return '';
  }

  return stringifyMessageContent(result.content).trim();
}

/**
 * 将日期格式化为本地 YYYY-MM-DD 字符串。
 *
 * @param date 要格式化的日期。
 * @returns 本地日期字符串。
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * 检查是否已配置和风天气认证信息。
 *
 * @returns 存在可用和风天气 token 变量时返回 true。
 */
function hasQWeatherToken(): boolean {
  return Boolean(process.env.WEATHER_API_TOKEN?.trim());
}

@Injectable()
export class WeatherService {
  private readonly conversations = new Map<
    string,
    WeatherConversationContext
  >();

  /**
   * 返回天气 Agent 运行状态。
   *
   * @returns 天气 Agent 配置状态。
   */
  getStatus(): WeatherAgentStatus {
    return {
      hasApiKey: Boolean(process.env.OPENAI_API_KEY),
      integrated: true,
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
  private getConversationContext(
    conversationId?: string,
  ): WeatherConversationContext | undefined {
    const normalizedConversationId = conversationId?.trim();

    if (!normalizedConversationId) {
      return undefined;
    }

    const context = this.conversations.get(normalizedConversationId);

    if (!context) {
      return undefined;
    }

    if (Date.now() - context.updatedAt > WEATHER_CONVERSATION_TTL_MS) {
      this.conversations.delete(normalizedConversationId);
      return undefined;
    }

    return context;
  }

  /**
   * 存储部分天气意图，供下一轮对话使用。
   *
   * @param conversationId 要更新的会话 ID。
   * @param context 天气会话上下文。
   */
  private saveConversationContext(
    conversationId: string,
    context: Omit<WeatherConversationContext, 'updatedAt'>,
  ): void {
    this.conversations.set(conversationId, {
      ...context,
      updatedAt: Date.now(),
    });
  }

  /**
   * 查询成功后清理已存储的天气上下文。
   *
   * @param conversationId 要清理的可选会话 ID。
   */
  private clearConversationContext(conversationId?: string): void {
    const normalizedConversationId = conversationId?.trim();

    if (normalizedConversationId) {
      this.conversations.delete(normalizedConversationId);
    }
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

    return [
      '这是一次多轮天气查询，请合并上一轮上下文和本轮用户补充后再判断是否可以查询。',
      `上一轮用户问题：${context.lastQuestion}`,
      `上一轮已识别意图：${JSON.stringify(context.partialIntent)}`,
      `上一轮缺失参数：${context.missingParams.join(', ') || '无'}`,
      `本轮用户补充：${message}`,
    ].join('\n');
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

    return this.queryByMessage(normalizedQuestion, conversationId);
  }

  /**
   * 在查询天气数据前解析自然语言天气请求。
   *
   * @param message 用户自然语言请求。
   * @returns 天气 Agent 响应。
   */
  private async queryByMessage(
    message: string,
    conversationId?: string,
  ): Promise<WeatherAgentResponse> {
    const context = this.buildQueryExecutionContext(
      message,
      conversationId,
      this.getRequiredOpenAIApiKey(),
    );

    try {
      const agentResult = await this.runWeatherAgent(
        context.agentMessage,
        context.apiKey,
      );

      if (agentResult.action === 'clarify') {
        return this.handleClarificationResult(message, context, agentResult);
      }

      return this.handleAnswerResult(message, context, agentResult);
    } catch (error) {
      return this.buildFailedResponse(
        message,
        context.normalizedConversationId,
        error,
      );
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
  private buildQueryExecutionContext(
    message: string,
    conversationId: string | undefined,
    apiKey: string,
  ): WeatherQueryExecutionContext {
    const normalizedConversationId = conversationId?.trim();
    const conversationContext = this.getConversationContext(
      normalizedConversationId,
    );
    const agentMessage = this.buildContextualWeatherMessage(
      message,
      conversationContext,
    );
    const originalDemandMessage = conversationContext
      ? `${conversationContext.lastQuestion}；用户补充：${message}`
      : message;

    return {
      agentMessage,
      apiKey,
      conversationContext,
      normalizedConversationId,
      originalDemandMessage,
    };
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
  ): Promise<WeatherAgentResponse> {
    const activeConversationId = this.resolveConversationId(
      context.normalizedConversationId,
    );
    const partialIntent = {
      ...context.conversationContext?.partialIntent,
      ...agentResult.intent,
    };
    const answer = await this.generateClarificationAnswer(
      context.originalDemandMessage,
      context.apiKey,
      partialIntent,
      agentResult.missingParams,
      agentResult.answer,
    );

    this.saveConversationContext(activeConversationId, {
      lastQuestion: context.conversationContext?.lastQuestion || message,
      missingParams: agentResult.missingParams,
      partialIntent,
    });

    return this.buildClarificationResponse(
      message,
      activeConversationId,
      partialIntent,
      agentResult.missingParams,
      answer,
    );
  }

  /**
   * 处理完整天气查询结果，并清理过期上下文。
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
  ): Promise<WeatherAgentResponse> {
    const intent = agentResult.intent;
    const weather = agentResult.weather;
    const forecast = this.findForecastByDate(weather, intent.date);
    const answer =
      (await this.generateDemandAwareAnswer(
        context.originalDemandMessage,
        context.apiKey,
        intent,
        weather,
        forecast,
        agentResult.answer,
      )) || this.buildFallbackAnswer(weather, intent, forecast);

    this.clearConversationContext(context.normalizedConversationId);

    return this.buildSuccessResponse(
      message,
      context.normalizedConversationId,
      intent,
      weather,
      answer,
    );
  }

  /**
   * 构建追问响应，保持公开 API 结构不变。
   *
   * @param message 当前用户消息。
   * @param conversationId 当前有效会话 ID。
   * @param partialIntent 已识别的部分天气意图。
   * @param missingParams 缺失的查询参数。
   * @param answer 自然语言追问回答。
   * @returns 天气追问响应。
   */
  private buildClarificationResponse(
    message: string,
    conversationId: string,
    partialIntent: Partial<WeatherIntent>,
    missingParams: string[],
    answer: string,
  ): WeatherAgentResponse {
    return {
      answer,
      city: partialIntent.city,
      conversationId,
      date: partialIntent.date,
      dateText: partialIntent.dateText,
      missingParams,
      model: this.getResponseModelName(),
      partialIntent,
      question: message,
      status: 'need_clarification',
    };
  }

  /**
   * 构建成功天气响应，保持公开 API 结构不变。
   *
   * @param message 当前用户消息。
   * @param conversationId 调用方传入的可选会话 ID。
   * @param intent 已解析的完整天气意图。
   * @param weather 标准化后的天气结果。
   * @param answer 自然语言回答。
   * @returns 天气查询成功响应。
   */
  private buildSuccessResponse(
    message: string,
    conversationId: string | undefined,
    intent: WeatherIntent,
    weather: WeatherResult,
    answer: string,
  ): WeatherAgentResponse {
    return {
      answer,
      city: intent.city,
      conversationId,
      date: intent.date,
      dateText: intent.dateText,
      intent,
      model: this.getResponseModelName(),
      question: message,
      status: 'success',
      weather,
    };
  }

  /**
   * 构建失败天气响应，避免主流程继续抛出异常。
   *
   * @param message 当前用户消息。
   * @param conversationId 调用方传入的可选会话 ID。
   * @param error 天气查询错误。
   * @returns 天气查询失败响应。
   */
  private buildFailedResponse(
    message: string,
    conversationId: string | undefined,
    error: unknown,
  ): WeatherAgentResponse {
    return {
      answer: this.buildApiFailureAnswer(message, error),
      conversationId,
      model: this.getResponseModelName(),
      question: message,
      status: 'failed',
    };
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
   * 创建面向 DashScope 的 OpenAI 兼容聊天模型。
   *
   * @param apiKey OpenAI 兼容 API Key。
   * @param temperature 模型采样温度。
   * @returns 配置完成的聊天模型。
   */
  private createChatModel(apiKey: string, temperature: number): ChatOpenAI {
    return new ChatOpenAI({
      apiKey,
      model: process.env.OPENAI_MODEL,
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
    const result = await agent.invoke({
      messages: [
        {
          content: `用户输入：${message}`,
          role: 'user',
        },
      ],
    });
    const output = getFinalAgentMessage(result);

    if (!output) {
      throw new BadRequestException(
        'Weather agent returned an empty response.',
      );
    }

    return this.validateWeatherAgentResult(
      JSON.parse(extractJsonObject(output)),
    );
  }

  /**
   * 校验用于天气意图解析的模型输出。
   *
   * @param value 已解析的模型 JSON 值。
   * @returns 有效的天气意图。
   */
  private validateWeatherIntent(value: unknown): WeatherIntent {
    if (!isRecord(value)) {
      throw new BadRequestException('Weather intent must be a JSON object.');
    }

    const city = getStringValue(value, 'city');
    const date = getStringValue(value, 'date');
    const dateText = getStringValue(value, 'dateText') || date;

    if (!city) {
      throw new BadRequestException('Unable to identify weather query city.');
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Unable to identify weather query date.');
    }

    return { city, date, dateText };
  }

  /**
   * 从追问响应中读取部分天气意图。
   *
   * @param value 已解析的模型意图值。
   * @returns 部分天气意图。
   */
  private validatePartialWeatherIntent(value: unknown): Partial<WeatherIntent> {
    if (!isRecord(value)) {
      return {};
    }

    const city = getStringValue(value, 'city');
    const date = getStringValue(value, 'date');
    const dateText = getStringValue(value, 'dateText');

    return {
      ...(city ? { city } : {}),
      ...(date ? { date } : {}),
      ...(dateText ? { dateText } : {}),
    };
  }

  /**
   * 校验结构化天气 Agent 响应。
   *
   * @param value 已解析的 Agent JSON 值。
   * @returns 有效的天气 Agent 结果。
   */
  private validateWeatherAgentResult(value: unknown): WeatherAgentRunResult {
    if (!isRecord(value)) {
      throw new BadRequestException('Weather agent result must be an object.');
    }

    const action = getStringValue(value, 'action');
    const answer = getStringValue(value, 'answer');

    if (action === 'clarify') {
      const missingParams = getStringArrayValue(value, 'missingParams');

      return {
        action,
        answer,
        intent: this.validatePartialWeatherIntent(value.intent),
        missingParams: missingParams.length ? missingParams : ['city'],
      };
    }

    const intent = this.validateWeatherIntent(value.intent);

    if (!isRecord(value.weather)) {
      throw new BadRequestException(
        'Weather agent result must include weather.',
      );
    }

    return {
      action: 'answer',
      answer,
      intent,
      weather: value.weather as unknown as WeatherResult,
    };
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
   * 在天气服务请求失败时构建稳定的兜底回答。
   *
   * @param message 用户原始问题。
   * @param error 天气查询错误。
   * @returns 面向用户的失败回答。
   */
  private buildApiFailureAnswer(message: string, error: unknown): string {
    const reason = error instanceof Error ? error.message : '';
    const normalizedReason = reason ? `（${reason}）` : '';

    return `抱歉，刚才查询天气服务失败${normalizedReason}。你可以稍后再试，或换一个更明确的城市名称重新查询。原始问题：${message}`;
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
    const result = await model.invoke([
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
    ]);

    return getChatModelMessage(result) || agentAnswer;
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
    const result = await model.invoke([
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
    ]);

    return getChatModelMessage(result);
  }

  /**
   * 在模型回答不可用时构建确定性的兜底回答。
   *
   * @param weather 标准化后的天气结果。
   * @param intent 已解析的天气意图。
   * @param forecast 可用时为目标日期的预报数据。
   * @returns 简洁的天气兜底回答。
   */
  private buildFallbackAnswer(
    weather: WeatherResult,
    intent: WeatherIntent,
    forecast: WeatherForecastDay | undefined,
  ): string {
    const current = weather.current;
    const forecastText = forecast
      ? `${intent.dateText}预计 ${forecast.minTemperature.celsius}°C 到 ${forecast.maxTemperature.celsius}°C。`
      : `当前数据源暂未覆盖 ${intent.dateText} 的预报。`;

    return `${intent.city}${intent.dateText}天气查询结果：${weather.resolvedCity}当前${current.description || '天气数据可用'}，气温 ${current.temperature.celsius}°C，体感 ${current.feelsLike.celsius}°C，湿度 ${current.humidity}%，风向 ${current.windDirection || '未知'}，风速 ${current.windSpeedKmph || '未知'} km/h。${forecastText}`;
  }
}
