/**
 * 通用助手消息状态常量。
 */
export const AGENT_MESSAGE_STATUS = {
  /** 消息已生成完毕并完成持久化。 */
  COMPLETED: 'completed',
  /** 消息对应流程发生错误。 */
  FAILED: 'failed',
} as const;

/**
 * 助手消息状态类型。
 */
export type AgentMessageStatus =
  (typeof AGENT_MESSAGE_STATUS)[keyof typeof AGENT_MESSAGE_STATUS];

/**
 * 通用助手消息角色常量。
 */
export const AGENT_MESSAGE_ROLE = {
  /** 模型或业务逻辑生成的助手消息。 */
  ASSISTANT: 'assistant',
  /** 系统级提示消息。 */
  SYSTEM: 'system',
  /** 工具调用相关消息。 */
  TOOL: 'tool',
  /** 用户输入消息。 */
  USER: 'user',
} as const;

/**
 * 助手消息角色类型（允许扩展自定义角色）。
 */
export type AgentMessageRole =
  | (typeof AGENT_MESSAGE_ROLE)[keyof typeof AGENT_MESSAGE_ROLE]
  | (string & {});

/**
 * 通用助手消息内容类型常量。
 */
export const AGENT_MESSAGE_CONTENT_TYPE = {
  /** 纯文本内容。 */
  TEXT: 'text',
} as const;

/**
 * 助手消息内容类型（允许扩展自定义内容类型）。
 */
export type AgentMessageContentType =
  | (typeof AGENT_MESSAGE_CONTENT_TYPE)[keyof typeof AGENT_MESSAGE_CONTENT_TYPE]
  | (string & {});

/**
 * 内置 Agent 产物类型常量。
 */
export const AGENT_ARTIFACT_TYPE = {
  /** 数据分析结果产物。 */
  DATA_ANALYSE_RESULT: 'data_analyse_result',
  /** 行政边界 SVG 结果产物。 */
  BOUNDARY_SVG_RESULT: 'boundary_svg_result',
  /** 天气查询结果产物。 */
  WEATHER_RESULT: 'weather_result',
} as const;

/**
 * 内置 Agent 产物类型。
 */
export type BuiltinAgentArtifactType =
  (typeof AGENT_ARTIFACT_TYPE)[keyof typeof AGENT_ARTIFACT_TYPE];

/**
 * Agent 产物类型（允许业务模块扩展自定义值）。
 */
export type AgentArtifactType = BuiltinAgentArtifactType | (string & {});

/**
 * Agent 运行状态常量。
 */
export const AGENT_RUN_STATUS = {
  /** 运行成功结束。 */
  COMPLETED: 'completed',
  /** 运行异常结束。 */
  FAILED: 'failed',
  /** 运行进行中。 */
  RUNNING: 'running',
} as const;

/**
 * Agent 运行状态类型。
 */
export type AgentRunStatus =
  (typeof AGENT_RUN_STATUS)[keyof typeof AGENT_RUN_STATUS];
