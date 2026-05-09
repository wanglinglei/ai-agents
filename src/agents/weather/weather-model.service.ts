import { BadRequestException, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { createLangChainLocalTraceConfig } from '../../common/langchain/langchain-local-trace';
import {
  getOpenAIApiKey,
  getOpenAICompatibleBaseUrl,
  getOpenAIModelName,
  hasOpenAIApiKey,
  hasWeatherApiToken,
} from '../../common/config/runtime-env.config';

const WEATHER_AGENT_KEY = 'weather';

/**
 * weather 模型配置与错误序列化服务。
 */
@Injectable()
export class WeatherModelService {
  /**
   * 返回天气服务是否具备基础模型配置。
   *
   * @returns 是否具备 API Key。
   */
  hasApiKey(): boolean {
    return hasOpenAIApiKey();
  }

  /**
   * 读取天气响应中暴露的模型名称。
   *
   * @returns 已配置的模型名称，或现有兜底模型名称。
   */
  getResponseModelName(): string {
    return getOpenAIModelName('qw-plus');
  }

  /**
   * 读取必需的 OpenAI 兼容 API Key，并校验和风天气 token。
   *
   * @returns OpenAI 兼容 API Key。
   */
  getRequiredOpenAIApiKey(): string {
    const apiKey = getOpenAIApiKey();

    if (!apiKey) {
      throw new BadRequestException(
        'OPENAI_API_KEY is required to parse natural language weather requests.',
      );
    }

    if (!hasWeatherApiToken()) {
      throw new BadRequestException(
        'QWeather token is required. Set WEATHER_API_TOKEN.',
      );
    }

    return apiKey;
  }

  /**
   * 构建天气 Agent 调试运行配置。
   *
   * @param runName 本次运行名称。
   * @param metadata 附加到本次运行的业务元数据。
   * @returns 启用本地日志时返回 runnable 配置，否则返回 undefined。
   */
  createWeatherDebugRunConfig(
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
  createChatModel(apiKey: string, temperature: number): ChatOpenAI {
    return new ChatOpenAI({
      apiKey,
      model: this.getResponseModelName(),
      temperature,
      configuration: {
        baseURL: getOpenAICompatibleBaseUrl(),
      },
    });
  }

  /**
   * 序列化任意错误对象，便于存储到 jsonb。
   *
   * @param error 任意错误对象。
   * @returns 可持久化的错误结构。
   */
  serializeError(error: unknown): Record<string, unknown> {
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
  toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }
}
