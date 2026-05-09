import { BadRequestException, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { createLangChainLocalTraceConfig } from '../../common/langchain/langchain-local-trace';
import {
  getOpenAIApiKey,
  getOpenAICompatibleBaseUrl,
  getOpenAIModelName,
} from '../../common/config/runtime-env.config';

const DATA_ANALYSE_AGENT_KEY = 'data_analyse';

/**
 * data-analyse 模型与通用序列化能力封装。
 */
@Injectable()
export class DataAnalyseModelService {
  /**
   * 获取回答模型名。
   *
   * @returns 模型名。
   */
  getResponseModelName(): string {
    return getOpenAIModelName('qw-plus');
  }

  /**
   * 确保模型 API Key 已配置。
   *
   * @returns API Key。
   */
  ensureApiKey(): string {
    const apiKey = getOpenAIApiKey();

    if (!apiKey) {
      throw new BadRequestException(
        '未配置 OPENAI_API_KEY，无法执行数据分析。',
      );
    }

    return apiKey;
  }

  /**
   * 构建模型调试配置。
   *
   * @param runName 运行名。
   * @param metadata 元数据。
   * @returns 调试配置或 undefined。
   */
  createDebugRunConfig(
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
  createChatModel(apiKey: string, temperature: number): ChatOpenAI {
    return new ChatOpenAI({
      apiKey,
      configuration: {
        baseURL: getOpenAICompatibleBaseUrl(),
      },
      model: this.getResponseModelName(),
      temperature,
    });
  }

  /**
   * 从模型响应读取文本。
   *
   * @param result 模型返回值。
   * @returns 纯文本输出。
   */
  getModelMessage(result: unknown): string {
    if (
      this.isRecord(result) &&
      'content' in result &&
      typeof result.content === 'string'
    ) {
      return result.content;
    }

    if (
      this.isRecord(result) &&
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
  stringifyMessageContent(content: unknown): string {
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

        if (this.isRecord(item)) {
          const text = item.text;
          return typeof text === 'string' ? text : '';
        }

        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 判断值是否为普通对象。
   *
   * @param value 任意值。
   * @returns 是否为 Record。
   */
  isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * 将值转换为可写入 jsonb 的普通对象。
   *
   * @param value 任意值。
   * @returns 标准对象记录。
   */
  toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }
}
