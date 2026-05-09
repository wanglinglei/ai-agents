import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AgentPersistenceService } from '../persistence/agent-persistence.service';
import type {
  WeatherConversationContext,
  WeatherForecastDay,
  WeatherIntent,
} from './types/weather-agent.types';
import type { WeatherResult } from './tools/weather.tool';

const WEATHER_AGENT_KEY = 'weather';
const WEATHER_CONVERSATION_TTL_MS = 10 * 60 * 1000;

/**
 * 天气会话上下文读写与组装服务。
 */
@Injectable()
export class WeatherConversationService {
  constructor(private readonly agentPersistence: AgentPersistenceService) {}

  /**
   * 生成或复用天气查询会话 ID。
   *
   * @param conversationId 调用方传入的可选会话 ID。
   * @returns 本次请求应使用的会话 ID。
   */
  resolveConversationId(conversationId?: string): string {
    return conversationId?.trim() || randomUUID();
  }

  /**
   * 读取未过期的天气会话上下文。
   *
   * @param conversationId 可选会话 ID。
   * @returns 存在且未过期的已存储上下文。
   */
  async getConversationContext(
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
  async saveConversationContext(
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
   * 构建包含上一轮上下文的天气 Agent 输入。
   *
   * @param message 当前用户消息。
   * @param context 上一轮天气会话上下文。
   * @returns 供天气 Agent 解析的消息。
   */
  buildContextualWeatherMessage(
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
   * 构建用于回答生成的需求描述，保留最近会话意图和本轮用户输入。
   *
   * @param message 本轮用户消息。
   * @param context 已存在的天气会话上下文。
   * @returns 面向回答模型的用户需求描述。
   */
  buildDemandMessage(
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
   * 构建用于多轮意图合并的最近天气摘要，避免把完整天气结果塞回模型。
   *
   * @param weather 最近一次成功查询的天气结果。
   * @param intent 最近一次完整天气意图。
   * @returns 可读的天气摘要。
   */
  buildWeatherContextSummary(
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
   * 查找目标日期对应的服务商预报数据。
   *
   * @param weather 标准化后的天气结果。
   * @param date YYYY-MM-DD 格式的目标日期。
   * @returns 可用时返回目标日期的预报数据。
   */
  findForecastByDate(
    weather: WeatherResult,
    date: string,
  ): WeatherForecastDay | undefined {
    return weather.forecast.find((forecast) => forecast.date === date);
  }
}
