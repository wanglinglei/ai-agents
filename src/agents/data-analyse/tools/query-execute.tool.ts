import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import type { DataSource } from 'typeorm';

const QUERY_EXECUTE_TOOL_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    sql: {
      description: '需要执行的只读 SQL 语句。',
      type: 'string',
    },
  },
  required: ['sql'],
  type: 'object',
} as const;

/**
 * SQL 执行结果。
 */
export interface QueryExecuteResult {
  /** 返回的数据行。 */
  rows: Record<string, unknown>[];
  /** 行数统计。 */
  rowCount: number;
}

/**
 * 执行只读 SQL 并将输出转换为可序列化结构。
 *
 * @param dataSource 已初始化的数据源。
 * @param sql 只读 SQL。
 * @returns 查询数据与行数。
 */
export async function executeReadonlyQuery(
  dataSource: DataSource,
  sql: string,
): Promise<QueryExecuteResult> {
  const rawResult: unknown = await dataSource.query(sql);
  const rows = normalizeRows(rawResult);

  return {
    rowCount: rows.length,
    rows,
  };
}

/**
 * 创建 LangChain 标准的只读 SQL 执行 Tool。
 *
 * @param dataSource 已初始化的数据源。
 * @returns 可供 LangChain Agent 调用的结构化 Tool。
 */
export function createQueryExecuteTool(dataSource: DataSource): DynamicStructuredTool {
  return tool(
    async (input: { sql: string }): Promise<QueryExecuteResult> =>
      executeReadonlyQuery(dataSource, input.sql),
    {
      description: '执行只读 SQL 查询并返回结果行及行数统计。',
      name: 'query_execute',
      schema: QUERY_EXECUTE_TOOL_INPUT_SCHEMA,
    },
  );
}

/**
 * 归一化 TypeORM `query` 返回结果，确保统一为对象数组。
 *
 * @param rawResult 原始查询结果。
 * @returns 可安全序列化的对象数组。
 */
function normalizeRows(rawResult: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rawResult)) {
    return [];
  }

  const rows = rawResult.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );

  return JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[];
}
