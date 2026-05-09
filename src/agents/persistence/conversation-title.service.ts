import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';

const TITLE_MAX_LENGTH = 80;
const DEFAULT_TITLE_MODEL = 'qw-plus';
const OPENAI_COMPATIBLE_BASE_URL = process.env.OPENAI_COMPATIBLE_BASE_URL;
const TITLE_GENERATION_PROMPT = `
你是一个会话标题生成助手。请根据给定上下文生成一个简洁、自然、可读的中文标题。

要求：
1. 输出只能是一行纯文本标题，不要引号、不要 Markdown、不要解释。
2. 标题长度建议 8~30 个汉字，最长不超过 80 个字符。
3. 标题要体现具体任务意图，不要生成“会话”“聊天”“分析结果”这类空泛词。
4. 如果信息不足，尽量基于用户输入生成最贴近意图的标题。
`;

interface ResolveConversationTitleInput {
  agentKey: string;
  metadata?: Record<string, unknown>;
  message?: string;
  providedTitle?: string;
}

/**
 * 会话标题生成与规范化服务。
 */
@Injectable()
export class ConversationTitleService {
  /**
   * 解析并生成会话标题。
   *
   * @param input 标题生成输入。
   * @returns 可持久化的标题文本。
   */
  async resolveTitle(input: ResolveConversationTitleInput): Promise<string> {
    const titleFromInput = this.normalizeTitle(input.providedTitle);
    if (titleFromInput) {
      return titleFromInput;
    }

    const aiGeneratedTitle = await this.generateTitleByModel(input);
    if (aiGeneratedTitle) {
      return aiGeneratedTitle;
    }

    return this.buildFallbackTitle(input);
  }

  /**
   * 调用模型生成会话标题。
   *
   * @param input 标题生成输入。
   * @returns 模型生成标题，失败时返回 undefined。
   */
  private async generateTitleByModel(
    input: ResolveConversationTitleInput,
  ): Promise<string | undefined> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      return undefined;
    }

    try {
      const model = new ChatOpenAI({
        apiKey,
        configuration: {
          baseURL: OPENAI_COMPATIBLE_BASE_URL,
        },
        model: process.env.OPENAI_MODEL ?? DEFAULT_TITLE_MODEL,
        temperature: 0.2,
      });

      const response = await model.invoke([
        {
          content: TITLE_GENERATION_PROMPT.trim(),
          role: 'system',
        },
        {
          content: JSON.stringify(
            {
              agentKey: input.agentKey,
              metadata: input.metadata ?? {},
              userInput: input.message ?? '',
            },
            null,
            2,
          ),
          role: 'user',
        },
      ]);

      return this.normalizeTitle(this.getModelMessage(response));
    } catch {
      return undefined;
    }
  }

  /**
   * 在模型不可用时生成兜底标题。
   *
   * @param input 标题生成输入。
   * @returns 默认标题。
   */
  private buildFallbackTitle(input: ResolveConversationTitleInput): string {
    const normalizedMessage = this.normalizeTitle(input.message);

    if (input.agentKey === 'data_analyse') {
      const table = this.readMetadataString(input.metadata, 'table');
      if (table && normalizedMessage) {
        return this.normalizeTitle(
          `数据分析:${table} - ${normalizedMessage}`,
        ) as string;
      }

      if (table) {
        return this.normalizeTitle(`数据分析:${table}`) as string;
      }

      if (normalizedMessage) {
        return this.normalizeTitle(`数据分析:${normalizedMessage}`) as string;
      }

      return '数据分析会话';
    }

    if (input.agentKey === 'weather') {
      if (normalizedMessage) {
        return normalizedMessage;
      }

      return '天气会话';
    }

    if (normalizedMessage) {
      return normalizedMessage;
    }

    return this.normalizeTitle(`${input.agentKey} 会话`) as string;
  }

  /**
   * 读取 metadata 中的字符串字段。
   *
   * @param metadata 元数据对象。
   * @param key 目标字段名。
   * @returns 去空白后的字符串，缺失时返回 undefined。
   */
  private readMetadataString(
    metadata: Record<string, unknown> | undefined,
    key: string,
  ): string | undefined {
    const value = metadata?.[key];

    if (typeof value !== 'string') {
      return undefined;
    }

    const normalizedValue = value.trim();
    return normalizedValue || undefined;
  }

  /**
   * 规范化标题文本：去多余空白并限制长度。
   *
   * @param title 原始标题。
   * @returns 规范化结果，空值返回 undefined。
   */
  private normalizeTitle(title?: string): string | undefined {
    if (typeof title !== 'string') {
      return undefined;
    }

    const collapsed = title.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
      return undefined;
    }

    return collapsed.slice(0, TITLE_MAX_LENGTH);
  }

  /**
   * 提取模型返回文本。
   *
   * @param result 模型返回对象。
   * @returns 纯文本结果。
   */
  private getModelMessage(result: unknown): string {
    if (!this.isRecord(result)) {
      return '';
    }

    const content = result.content;
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

        if (!this.isRecord(item)) {
          return '';
        }

        const text = item.text;
        return typeof text === 'string' ? text : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 判断值是否为普通对象。
   *
   * @param value 待判断值。
   * @returns 是否是普通对象。
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
