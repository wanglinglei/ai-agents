import type { DataAnalyseAgentResponse } from '../types/data-analyse-agent.types';

interface DataAnalyseBaseResponseInput {
  conversationId: string;
  message: string;
  model: string | null;
}

interface DataAnalyseClarifyResponseInput extends DataAnalyseBaseResponseInput {
  answer: string;
  intent: string;
  missingParams: string[];
}

interface DataAnalyseFailedResponseInput extends DataAnalyseBaseResponseInput {
  answer: string;
}

interface DataAnalyseSuccessResponseInput extends DataAnalyseBaseResponseInput {
  answer: string;
  intent: string;
  rowCount: number;
  rowsPreview: Record<string, unknown>[];
  sql: string;
}

/**
 * 构建追问补参响应。
 *
 * @param input 响应输入。
 * @returns 标准化追问响应。
 */
export function buildClarificationResponse(
  input: DataAnalyseClarifyResponseInput,
): DataAnalyseAgentResponse {
  return {
    answer: input.answer,
    conversationId: input.conversationId,
    intent: input.intent,
    missingParams: input.missingParams,
    model: input.model,
    question: input.message,
    status: 'need_clarification',
  };
}

/**
 * 构建查询成功响应。
 *
 * @param input 响应输入。
 * @returns 标准化成功响应。
 */
export function buildSuccessResponse(
  input: DataAnalyseSuccessResponseInput,
): DataAnalyseAgentResponse {
  return {
    answer: input.answer,
    conversationId: input.conversationId,
    intent: input.intent,
    model: input.model,
    question: input.message,
    rowCount: input.rowCount,
    rowsPreview: input.rowsPreview,
    sql: input.sql,
    status: 'success',
  };
}

/**
 * 构建查询失败响应。
 *
 * @param input 响应输入。
 * @returns 标准化失败响应。
 */
export function buildFailedResponse(
  input: DataAnalyseFailedResponseInput,
): DataAnalyseAgentResponse {
  return {
    answer: input.answer,
    conversationId: input.conversationId,
    model: input.model,
    question: input.message,
    status: 'failed',
  };
}

/**
 * 构建 API 或执行失败时的兜底文案。
 *
 * @param message 用户问题。
 * @param error 捕获到的错误。
 * @returns 面向用户的失败文案。
 */
export function buildApiFailureAnswer(message: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : '';
  const normalizedReason = reason ? `（${reason}）` : '';

  return `抱歉，数据分析执行失败${normalizedReason}。请确认数据库连接、表名与问题描述后重试。原始问题：${message}`;
}
