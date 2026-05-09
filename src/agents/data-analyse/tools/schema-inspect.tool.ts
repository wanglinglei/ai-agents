import { BadRequestException } from '@nestjs/common';
import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import type { DataSource } from 'typeorm';
import type {
  DataAnalyseColumnSchema,
  DataAnalyseConnectionInput,
  DataAnalyseTableSchema,
} from '../types/data-analyse-agent.types';

const SCHEMA_INSPECT_TOOL_INPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    table: {
      description: '需要查询结构的目标表名，支持 schema.table 形式。',
      type: 'string',
    },
  },
  required: ['table'],
  type: 'object',
} as const;

/**
 * 查询目标表结构并统一转换为标准格式。
 *
 * @param dataSource 动态数据库连接。
 * @param connection 连接信息。
 * @param table 表名。
 * @returns 标准化后的表结构。
 */
export async function inspectTableSchema(
  dataSource: DataSource,
  connection: DataAnalyseConnectionInput,
  table: string,
): Promise<DataAnalyseTableSchema> {
  const normalizedTable = table.trim();

  if (!normalizedTable) {
    throw new BadRequestException('表名不能为空。');
  }

  const columns =
    connection.dbType === 'postgres'
      ? await queryPostgresTableSchema(dataSource, normalizedTable)
      : await queryMysqlTableSchema(
          dataSource,
          connection.database,
          normalizedTable,
        );

  if (!columns.length) {
    throw new BadRequestException(`未找到表 ${normalizedTable} 的结构信息。`);
  }

  return {
    columns,
    database: connection.database,
    dbType: connection.dbType,
    table: normalizedTable,
  };
}

/**
 * 创建 LangChain 标准的表结构查询 Tool。
 *
 * @param dataSource 动态数据库连接。
 * @param connection 连接信息。
 * @returns 可供 LangChain Agent 调用的结构化 Tool。
 */
export function createSchemaInspectTool(
  dataSource: DataSource,
  connection: DataAnalyseConnectionInput,
): DynamicStructuredTool {
  return tool(
    async (input: { table: string }): Promise<DataAnalyseTableSchema> =>
      inspectTableSchema(dataSource, connection, input.table),
    {
      description:
        '查询指定表的字段结构，返回字段名、类型、是否可空、默认值、主键信息等元数据。',
      name: 'schema_inspect',
      schema: SCHEMA_INSPECT_TOOL_INPUT_SCHEMA,
    },
  );
}

/**
 * 读取 PostgreSQL 表结构。
 *
 * @param dataSource 数据源。
 * @param table 表名。
 * @returns 标准化字段列表。
 */
async function queryPostgresTableSchema(
  dataSource: DataSource,
  table: string,
): Promise<DataAnalyseColumnSchema[]> {
  const rawRows: unknown = await dataSource.query(
    `
      SELECT
        c.column_name AS "columnName",
        c.data_type AS "dataType",
        c.is_nullable AS "isNullable",
        c.column_default AS "columnDefault",
        c.ordinal_position AS "ordinalPosition",
        EXISTS (
          SELECT 1
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.table_schema = c.table_schema
            AND tc.table_name = c.table_name
            AND tc.constraint_type = 'PRIMARY KEY'
            AND kcu.column_name = c.column_name
        ) AS "isPrimaryKey"
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = $1
      ORDER BY c.ordinal_position ASC
    `,
    [table],
  );

  const rows = normalizeRecordRows(rawRows);

  return rows.map(
    (row): DataAnalyseColumnSchema => ({
      defaultValue: getNullableStringValue(row, 'columnDefault'),
      name: getStringValue(row, 'columnName'),
      nullable: getStringValue(row, 'isNullable').toUpperCase() === 'YES',
      ordinalPosition: Number(getStringValue(row, 'ordinalPosition') || 0),
      primaryKey: getBooleanValue(row, 'isPrimaryKey'),
      type: getStringValue(row, 'dataType'),
    }),
  );
}

/**
 * 读取 MySQL 表结构。
 *
 * @param dataSource 数据源。
 * @param database 数据库名。
 * @param table 表名。
 * @returns 标准化字段列表。
 */
async function queryMysqlTableSchema(
  dataSource: DataSource,
  database: string,
  table: string,
): Promise<DataAnalyseColumnSchema[]> {
  const rawRows: unknown = await dataSource.query(
    `
      SELECT
        c.COLUMN_NAME AS columnName,
        c.DATA_TYPE AS dataType,
        c.IS_NULLABLE AS isNullable,
        c.COLUMN_DEFAULT AS columnDefault,
        c.ORDINAL_POSITION AS ordinalPosition,
        c.COLUMN_KEY AS columnKey
      FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = ?
        AND c.TABLE_NAME = ?
      ORDER BY c.ORDINAL_POSITION ASC
    `,
    [database, table],
  );

  const rows = normalizeRecordRows(rawRows);

  return rows.map(
    (row): DataAnalyseColumnSchema => ({
      defaultValue: getNullableStringValue(row, 'columnDefault'),
      name: getStringValue(row, 'columnName'),
      nullable: getStringValue(row, 'isNullable').toUpperCase() === 'YES',
      ordinalPosition: Number(getStringValue(row, 'ordinalPosition') || 0),
      primaryKey: getStringValue(row, 'columnKey').toUpperCase() === 'PRI',
      type: getStringValue(row, 'dataType'),
    }),
  );
}

/**
 * 将原始 SQL 结果归一化为对象数组。
 *
 * @param rawRows 原始查询结果。
 * @returns 对象数组。
 */
function normalizeRecordRows(rawRows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rawRows)) {
    return [];
  }

  return rawRows.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

/**
 * 从记录中读取字符串值。
 *
 * @param record 来源对象。
 * @param key 键名。
 * @returns 字符串值。
 */
function getStringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return '';
}

/**
 * 从记录中读取可空字符串值。
 *
 * @param record 来源对象。
 * @param key 键名。
 * @returns 可空字符串。
 */
function getNullableStringValue(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }

  return JSON.stringify(value);
}

/**
 * 从记录中读取布尔值。
 *
 * @param record 来源对象。
 * @param key 键名。
 * @returns 布尔值。
 */
function getBooleanValue(
  record: Record<string, unknown>,
  key: string,
): boolean {
  const value = record[key];
  return value === true || value === 'true' || value === 1 || value === '1';
}
