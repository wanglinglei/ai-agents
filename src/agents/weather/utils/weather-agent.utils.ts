import { BadRequestException } from '@nestjs/common';
import { hasWeatherApiToken } from '../../../common/config/runtime-env.config';

/**
 * 判断传入值是否为普通对象记录。
 *
 * @param value 要检查的值。
 * @returns 当该值可以按对象记录读取时返回 true。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从对象记录中读取字符串值。
 *
 * @param record 来源对象记录。
 * @param key 要读取的属性名。
 * @returns 字符串值，不存在时返回空字符串。
 */
export function getStringValue(
  record: Record<string, unknown>,
  key: string,
): string {
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
export function getStringArrayValue(
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
export function extractJsonObject(output: string): string {
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
export function stringifyMessageContent(value: unknown): string {
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
export function getFinalAgentMessage(result: unknown): string {
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
export function getChatModelMessage(result: unknown): string {
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
export function formatLocalDate(date: Date): string {
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
export function hasQWeatherToken(): boolean {
  return hasWeatherApiToken();
}
