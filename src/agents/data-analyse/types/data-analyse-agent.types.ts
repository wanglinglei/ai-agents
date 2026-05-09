/**
 * 支持的数据源类型。
 */
export type DataAnalyseDbType = 'mysql' | 'postgres';

/**
 * 数据分析 Agent 对外响应状态。
 */
export type DataAnalyseAgentResponseStatus =
  | 'failed'
  | 'need_clarification'
  | 'success';

/**
 * 单列字段结构定义。
 */
export interface DataAnalyseColumnSchema {
  /** 字段名。 */
  name: string;
  /** 字段类型。 */
  type: string;
  /** 字段是否可为空。 */
  nullable: boolean;
  /** 是否主键。 */
  primaryKey: boolean;
  /** 字段默认值（若可获取）。 */
  defaultValue?: string | null;
  /** 字段顺序（从 1 开始）。 */
  ordinalPosition: number;
}

/**
 * 目标表结构信息。
 */
export interface DataAnalyseTableSchema {
  /** 数据库名。 */
  database: string;
  /** 表名。 */
  table: string;
  /** 结构所属数据库类型。 */
  dbType: DataAnalyseDbType;
  /** 字段列表。 */
  columns: DataAnalyseColumnSchema[];
}

/**
 * 调用数据分析 Agent 的连接输入。
 */
export interface DataAnalyseConnectionInput {
  /** 数据库类型。 */
  dbType: DataAnalyseDbType;
  /** 数据库地址。 */
  host: string;
  /** 数据库端口。 */
  port: number;
  /** 用户名。 */
  username: string;
  /** 密码。 */
  password: string;
  /** 数据库名。 */
  database: string;
}

/**
 * 数据分析查询请求体。
 */
export interface DataAnalyseQueryRequest {
  /** 会话 ID，可选。 */
  conversationId?: string;
  /** 用户自然语言问题。 */
  message: string;
  /** 要查询的表名。 */
  table: string;
  /** 数据库连接信息。 */
  connection: DataAnalyseConnectionInput;
}

/**
 * 数据分析 Agent 运行状态。
 */
export interface DataAnalyseAgentStatus {
  /** 是否已配置模型 API Key。 */
  hasApiKey: boolean;
  /** 能力是否已集成。 */
  integrated: boolean;
  /** 本地 trace 是否开启。 */
  localTrace: boolean;
  /** 当前模型名称。 */
  model: string;
  /** 供应商名称。 */
  provider: string;
  /** 已支持的数据库类型。 */
  supportedDbTypes: DataAnalyseDbType[];
}

/**
 * SQL 规划阶段返回的结构化结果。
 */
export type DataAnalysePlanResult =
  | {
      /** 需要用户补充信息。 */
      action: 'clarify';
      /** 追问内容。 */
      clarificationQuestion: string;
      /** 缺失参数列表。 */
      missingParams: string[];
      /** 对问题的意图摘要。 */
      intent: string;
    }
  | {
      /** 可以继续执行 SQL。 */
      action: 'query';
      /** 对问题的意图摘要。 */
      intent: string;
      /** 生成 SQL 的简短原因说明。 */
      reasoning: string;
      /** 待执行 SQL。 */
      sql: string;
      /** 预期返回字段。 */
      expectedColumns: string[];
    };

/**
 * 数据分析查询响应。
 */
export interface DataAnalyseAgentResponse {
  /** 面向用户的回答。 */
  answer: string;
  /** 会话 ID。 */
  conversationId?: string;
  /** 本轮用户问题。 */
  question: string;
  /** 状态。 */
  status: DataAnalyseAgentResponseStatus;
  /** 本轮使用模型。 */
  model: string | null;
  /** 意图摘要。 */
  intent?: string;
  /** 缺失参数列表。 */
  missingParams?: string[];
  /** 最终执行 SQL。 */
  sql?: string;
  /** 返回行数。 */
  rowCount?: number;
  /** 结果预览。 */
  rowsPreview?: Record<string, unknown>[];
}
