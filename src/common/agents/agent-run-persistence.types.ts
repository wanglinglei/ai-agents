import type {
  AgentArtifactType,
  AgentMessageStatus,
} from './agent-run.constants';

/**
 * 可复用 JSON 对象结构。
 */
export type JsonRecord = Record<string, unknown>;

/**
 * 成功运行时可选的产物写入参数。
 */
export interface SuccessfulRunArtifactInput {
  /** 产物类型标识。 */
  artifactType: AgentArtifactType;
  /** 产物核心数据。 */
  data?: JsonRecord;
  /** 产物元信息。 */
  metadata?: JsonRecord;
  /** 产物展示标题。 */
  title?: string | null;
  /** 外部存储链接。 */
  storageUrl?: string | null;
}

/**
 * 成功运行持久化输入参数。
 */
export interface PersistSuccessfulRunInput {
  /** 会话 ID。 */
  conversationId: string;
  /** 运行 ID。 */
  runId: string;
  /** 助手最终回答。 */
  answer: string;
  /** 助手消息元信息。 */
  messageMetadata: JsonRecord;
  /** 助手消息状态（默认 completed）。 */
  messageStatus?: AgentMessageStatus;
  /** 可选产物写入参数。 */
  artifact?: SuccessfulRunArtifactInput;
  /** 需要回填到消息 metadata 的产物 ID 字段名。 */
  artifactMessageMetadataKey?: string;
  /** 是否在本次持久化后完成 run。 */
  completeRun?: boolean;
  /** 显式 run 输出快照。 */
  output?: JsonRecord;
  /** 动态构建 run 输出快照（优先级高于 output）。 */
  buildOutput?: (artifactId?: string) => JsonRecord;
}

/**
 * 失败运行持久化输入参数。
 */
export interface PersistFailedRunInput {
  /** 会话 ID。 */
  conversationId: string;
  /** 运行 ID。 */
  runId: string;
  /** 面向用户的失败回答。 */
  answer: string;
  /** 失败消息元信息。 */
  messageMetadata: JsonRecord;
  /** 失败错误快照。 */
  error: JsonRecord;
  /** 失败消息状态（默认 failed）。 */
  messageStatus?: AgentMessageStatus;
}
