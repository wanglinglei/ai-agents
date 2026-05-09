import { BadRequestException, Injectable } from '@nestjs/common';
import { ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildDataAnalysePlannerPrompt } from './prompts/data-analyse-agent.prompt';
import {
  createQueryExecuteTool,
  type QueryExecuteResult,
} from './tools/query-execute.tool';
import { createSchemaInspectTool } from './tools/schema-inspect.tool';
import type {
  DataAnalyseConnectionInput,
  DataAnalyseTableSchema,
} from './types/data-analyse-agent.types';
import { DataAnalyseModelService } from './data-analyse-model.service';

const RESPONSE_ROWS_LIMIT = 1000;
const RESPONSE_ROWS_PREVIEW_LIMIT = 20;

type DataAnalyseRuntimeTool = {
  invoke: (
    input: Record<string, unknown>,
    config?: RunnableConfig,
  ) => Promise<unknown>;
  name: string;
};

export interface DataAnalyseExecutionResult {
  intent: string;
  queryResult: QueryExecuteResult;
  schema: DataAnalyseTableSchema;
  sql: string;
}

/**
 * data-analyse 的查询编排与工具执行服务。
 */
@Injectable()
export class DataAnalyseExecutionService {
  constructor(private readonly modelService: DataAnalyseModelService) {}

  /**
   * 创建并初始化动态数据源。
   *
   * @param connection 数据库连接参数。
   * @returns 可执行查询的数据源。
   */
  async createAndInitializeDataSource(
    connection: DataAnalyseConnectionInput,
  ): Promise<DataSource> {
    const dataSource = new DataSource({
      database: connection.database,
      host: connection.host,
      logging: false,
      password: connection.password,
      port: connection.port,
      synchronize: false,
      type: connection.dbType,
      username: connection.username,
    });

    return dataSource.initialize();
  }

  /**
   * 销毁动态数据源，避免连接泄漏。
   *
   * @param dataSource 动态数据源。
   */
  async destroyDataSource(dataSource: DataSource | null): Promise<void> {
    if (!dataSource?.isInitialized) {
      return;
    }

    await dataSource.destroy();
  }

  /**
   * 使用 LangChain tool-calling 执行“查结构 + 跑查询”流程。
   *
   * @param input 执行所需上下文。
   * @returns 结构、SQL、查询结果和意图。
   */
  async executeWithToolCalling(input: {
    apiKey: string;
    connection: DataAnalyseConnectionInput;
    dataSource: DataSource;
    message: string;
    table: string;
  }): Promise<DataAnalyseExecutionResult> {
    const schemaInspectTool = createSchemaInspectTool(
      input.dataSource,
      input.connection,
    ) as unknown as DataAnalyseRuntimeTool;
    const queryExecuteTool = createQueryExecuteTool(
      input.dataSource,
    ) as unknown as DataAnalyseRuntimeTool;

    const plannerModel = this.modelService
      .createChatModel(input.apiKey, 0)
      .bindTools([schemaInspectTool, queryExecuteTool]);
    const plannerPrompt = [
      buildDataAnalysePlannerPrompt(input.connection.dbType),
      '你必须优先调用 schema_inspect，再根据结构调用 query_execute。',
      `目标表固定为：${input.table}，不要改成其他表。`,
      'query_execute 的 sql 必须是只读查询，不允许任何写入或 DDL 语句。',
      `最终 SQL 必须限制返回行数，LIMIT 不得超过 ${RESPONSE_ROWS_LIMIT}。`,
      '完成工具调用后，仅输出 JSON，至少包含 action 与 intent 字段。',
    ].join('\n');
    const messages: Array<
      | { content: string; role: 'system' | 'user' }
      | ToolMessage
      | Awaited<ReturnType<typeof plannerModel.invoke>>
    > = [
      {
        content: plannerPrompt,
        role: 'system',
      },
      {
        content: JSON.stringify(
          {
            question: input.message,
            table: input.table,
          },
          null,
          2,
        ),
        role: 'user',
      },
    ];

    let latestSchema: DataAnalyseTableSchema | null = null;
    let latestQueryResult: QueryExecuteResult | null = null;
    let latestSql: string | null = null;
    let plannerIntent = `基于 ${input.table} 的数据分析：${input.message}`;

    for (let step = 0; step < 6; step += 1) {
      const aiMessage = await plannerModel.invoke(
        messages,
        this.modelService.createDebugRunConfig(
          'data-analyse.plan.tool-calling',
          {
            step: step + 1,
          },
        ),
      );
      messages.push(aiMessage);
      plannerIntent = this.extractPlannerIntent(
        aiMessage.content,
        plannerIntent,
      );
      const toolCalls = Array.isArray(aiMessage.tool_calls)
        ? aiMessage.tool_calls
        : [];

      if (!toolCalls.length) {
        break;
      }

      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id ?? randomUUID();
        const tool = this.resolveDataAnalyseTool(
          toolCall.name,
          schemaInspectTool,
          queryExecuteTool,
        );

        if (!tool) {
          messages.push(
            new ToolMessage({
              content: JSON.stringify({
                error: `未知工具：${toolCall.name}`,
              }),
              status: 'error',
              tool_call_id: toolCallId,
            }),
          );
          continue;
        }

        const normalizedToolArgs = this.normalizeToolArgsForExecution(
          toolCall.name,
          toolCall.args,
        );
        const toolOutput = await this.invokeDataAnalyseTool(
          tool,
          normalizedToolArgs,
          'data-analyse.tool.execute',
          {
            step: step + 1,
            tool: toolCall.name,
          },
        );

        if (toolCall.name === 'schema_inspect') {
          const schema = this.parseSchemaToolOutput(toolOutput);
          latestSchema = schema;
          messages.push(
            new ToolMessage({
              content: JSON.stringify(schema),
              tool_call_id: toolCallId,
            }),
          );
          continue;
        }

        if (toolCall.name === 'query_execute') {
          const queryResult = this.parseQueryToolOutput(toolOutput);
          latestQueryResult = queryResult;
          latestSql =
            typeof normalizedToolArgs.sql === 'string'
              ? normalizedToolArgs.sql
              : latestSql;
          messages.push(
            new ToolMessage({
              content: JSON.stringify({
                rowCount: queryResult.rowCount,
                rows: queryResult.rows.slice(0, RESPONSE_ROWS_PREVIEW_LIMIT),
              }),
              tool_call_id: toolCallId,
            }),
          );
          continue;
        }

        messages.push(
          new ToolMessage({
            content: JSON.stringify({
              error: `未知工具：${toolCall.name}`,
            }),
            status: 'error',
            tool_call_id: toolCallId,
          }),
        );
      }
    }

    if (!latestSchema) {
      const fallbackSchema = await this.invokeDataAnalyseTool(
        schemaInspectTool,
        {
          table: input.table,
        },
        'data-analyse.tool.fallback.schema',
        {
          reason: 'missing_schema',
        },
      );
      latestSchema = this.parseSchemaToolOutput(fallbackSchema);
    }

    if (!latestSql || !latestQueryResult) {
      latestSql = this.buildDefaultAnalysisSql(
        input.connection.dbType,
        latestSchema.table,
      );
      const fallbackResult = await this.invokeDataAnalyseTool(
        queryExecuteTool,
        {
          sql: latestSql,
        },
        'data-analyse.tool.fallback.query',
        {
          reason: 'missing_result',
        },
      );
      latestQueryResult = this.parseQueryToolOutput(fallbackResult);
    }

    return {
      intent: plannerIntent,
      queryResult: latestQueryResult,
      schema: latestSchema,
      sql: latestSql,
    };
  }

  /**
   * 构建“全字段取数”分析 SQL。
   *
   * @param dbType 数据库类型。
   * @param table 表名。
   * @returns 默认分析 SQL。
   */
  private buildDefaultAnalysisSql(
    dbType: DataAnalyseConnectionInput['dbType'],
    table: string,
  ): string {
    const safeTable = this.escapeTableIdentifier(dbType, table);
    return `SELECT * FROM ${safeTable} LIMIT ${RESPONSE_ROWS_LIMIT}`;
  }

  /**
   * 从 tool 参数中提取 SQL 文本。
   *
   * @param args 工具调用参数。
   * @returns SQL 文本。
   */
  private extractSqlFromToolArgs(args: unknown): string {
    if (
      typeof args === 'object' &&
      args !== null &&
      'sql' in args &&
      typeof args.sql === 'string'
    ) {
      return args.sql;
    }

    throw new BadRequestException('query_execute 缺少 sql 参数。');
  }

  /**
   * 从 tool 参数中提取表名。
   *
   * @param args 工具调用参数。
   * @returns 目标表名。
   */
  private extractTableFromToolArgs(args: unknown): string {
    if (
      typeof args === 'object' &&
      args !== null &&
      'table' in args &&
      typeof args.table === 'string'
    ) {
      return args.table;
    }

    throw new BadRequestException('schema_inspect 缺少 table 参数。');
  }

  /**
   * 解析并验证 schema tool 返回结构。
   *
   * @param output tool 原始输出。
   * @returns 结构化表结构。
   */
  private parseSchemaToolOutput(output: unknown): DataAnalyseTableSchema {
    if (!this.modelService.isRecord(output)) {
      throw new BadRequestException('schema_inspect 返回结果格式错误。');
    }

    if (
      typeof output.database !== 'string' ||
      typeof output.table !== 'string' ||
      (output.dbType !== 'mysql' && output.dbType !== 'postgres') ||
      !Array.isArray(output.columns)
    ) {
      throw new BadRequestException('schema_inspect 返回字段缺失。');
    }
    const parsedColumns = output.columns
      .filter((column): column is Record<string, unknown> =>
        this.modelService.isRecord(column),
      )
      .map((column) => ({
        defaultValue:
          column.defaultValue === null ||
          column.defaultValue === undefined ||
          typeof column.defaultValue === 'string'
            ? (column.defaultValue ?? null)
            : typeof column.defaultValue === 'number' ||
                typeof column.defaultValue === 'boolean' ||
                typeof column.defaultValue === 'bigint'
              ? `${column.defaultValue}`
              : JSON.stringify(column.defaultValue),
        name: typeof column.name === 'string' ? column.name : '',
        nullable: Boolean(column.nullable),
        ordinalPosition: Number(column.ordinalPosition ?? 0),
        primaryKey: Boolean(column.primaryKey),
        type: typeof column.type === 'string' ? column.type : '',
      }));

    if (
      parsedColumns.length !== output.columns.length ||
      parsedColumns.some((column) => !column.name || !column.type)
    ) {
      throw new BadRequestException('schema_inspect 返回字段结构非法。');
    }

    return {
      columns: parsedColumns,
      database: output.database,
      dbType: output.dbType,
      table: output.table,
    };
  }

  /**
   * 解析并验证 query tool 返回结构。
   *
   * @param output tool 原始输出。
   * @returns 查询结果对象。
   */
  private parseQueryToolOutput(output: unknown): QueryExecuteResult {
    if (!this.modelService.isRecord(output)) {
      throw new BadRequestException('query_execute 返回结果格式错误。');
    }

    if (!Array.isArray(output.rows) || typeof output.rowCount !== 'number') {
      throw new BadRequestException('query_execute 返回字段缺失。');
    }
    const rows = output.rows.filter((row): row is Record<string, unknown> =>
      this.modelService.isRecord(row),
    );

    if (rows.length !== output.rows.length) {
      throw new BadRequestException('query_execute rows 数据结构非法。');
    }

    return {
      rowCount: output.rowCount,
      rows,
    };
  }

  /**
   * 为工具执行准备参数并注入安全规则。
   *
   * @param toolName 工具名称。
   * @param args 模型提供的参数。
   * @returns 可执行工具参数。
   */
  private normalizeToolArgsForExecution(
    toolName: string,
    args: unknown,
  ): Record<string, unknown> {
    if (toolName === 'schema_inspect') {
      return {
        table: this.extractTableFromToolArgs(args),
      };
    }

    if (toolName === 'query_execute') {
      const sql = this.normalizeReadonlySql(this.extractSqlFromToolArgs(args));
      return { sql };
    }

    if (this.modelService.isRecord(args)) {
      return args;
    }

    return {};
  }

  /**
   * 根据名称解析数据分析工具实例。
   *
   * @param toolName 工具名。
   * @param schemaInspectTool 结构查询工具。
   * @param queryExecuteTool SQL 执行工具。
   * @returns 命中的工具或 null。
   */
  private resolveDataAnalyseTool(
    toolName: string,
    schemaInspectTool: DataAnalyseRuntimeTool,
    queryExecuteTool: DataAnalyseRuntimeTool,
  ): DataAnalyseRuntimeTool | null {
    if (toolName === schemaInspectTool.name) {
      return schemaInspectTool;
    }

    if (toolName === queryExecuteTool.name) {
      return queryExecuteTool;
    }

    return null;
  }

  /**
   * 通过统一入口执行 Tool，便于注入调试配置。
   *
   * @param tool 目标工具实例。
   * @param input 工具输入参数。
   * @param runName trace 运行名。
   * @param metadata trace 元数据。
   * @returns 工具执行输出。
   */
  private async invokeDataAnalyseTool(
    tool: DataAnalyseRuntimeTool,
    input: Record<string, unknown>,
    runName: string,
    metadata: Record<string, unknown>,
  ): Promise<unknown> {
    return tool.invoke(
      input,
      this.modelService.createDebugRunConfig(runName, metadata),
    );
  }

  /**
   * 校验并规范化只读 SQL，限制模型执行风险。
   *
   * @param sql 原始 SQL。
   * @returns 安全 SQL。
   */
  private normalizeReadonlySql(sql: string): string {
    const normalizedSql = sql.trim().replace(/;+\s*$/g, '');
    const blockedKeywordPattern =
      /\b(ALTER|CREATE|DELETE|DROP|GRANT|INSERT|MERGE|REPLACE|REVOKE|TRUNCATE|UPDATE)\b/i;

    if (!normalizedSql) {
      throw new BadRequestException('SQL 不能为空。');
    }

    if (normalizedSql.includes(';')) {
      throw new BadRequestException('仅支持单条 SQL 查询。');
    }

    if (!/^(SELECT|WITH)\b/i.test(normalizedSql)) {
      throw new BadRequestException('仅支持 SELECT/WITH 查询。');
    }

    if (blockedKeywordPattern.test(normalizedSql)) {
      throw new BadRequestException('SQL 包含不允许的写操作或 DDL 关键字。');
    }

    const limitMatch = normalizedSql.match(/\bLIMIT\s+(\d+)\b/i);
    if (!limitMatch) {
      return `${normalizedSql} LIMIT ${RESPONSE_ROWS_LIMIT}`;
    }

    const limitValue = Number(limitMatch[1]);
    if (!Number.isFinite(limitValue) || limitValue <= 0) {
      throw new BadRequestException('SQL LIMIT 值不合法。');
    }

    if (limitValue > RESPONSE_ROWS_LIMIT) {
      throw new BadRequestException(
        `SQL LIMIT 不能超过 ${RESPONSE_ROWS_LIMIT}。`,
      );
    }

    return normalizedSql;
  }

  /**
   * 从规划模型输出中提取意图字段。
   *
   * @param content 模型 content。
   * @param fallback 无法解析时的回退意图。
   * @returns 当前可用意图。
   */
  private extractPlannerIntent(content: unknown, fallback: string): string {
    const text = this.modelService.stringifyMessageContent(content).trim();
    if (!text) {
      return fallback;
    }

    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'intent' in parsed &&
        typeof parsed.intent === 'string' &&
        parsed.intent.trim()
      ) {
        return parsed.intent.trim();
      }
    } catch {
      return fallback;
    }

    return fallback;
  }

  /**
   * 对表名进行白名单校验并按方言转义。
   *
   * @param dbType 数据库类型。
   * @param table 原始表名（支持 schema.table）。
   * @returns 可安全拼接到 SQL 的表名。
   */
  private escapeTableIdentifier(
    dbType: DataAnalyseConnectionInput['dbType'],
    table: string,
  ): string {
    const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const segments = table.split('.').map((segment) => segment.trim());

    if (
      !segments.length ||
      segments.some((segment) => !identifierPattern.test(segment))
    ) {
      throw new BadRequestException(
        '表名格式不合法，仅支持字母数字下划线及 schema.table。',
      );
    }

    if (dbType === 'postgres') {
      return segments.map((segment) => `"${segment}"`).join('.');
    }

    return segments.map((segment) => `\`${segment}\``).join('.');
  }
}
