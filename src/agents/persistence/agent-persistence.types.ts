import type {
  AgentArtifactType,
  AgentMessageContentType,
  AgentMessageRole,
  AgentMessageStatus,
  JsonRecord,
} from '../../common/agents';

/**
 * 读取或创建会话时的输入参数。
 */
export interface EnsureConversationInput {
  /** 业务 Agent 标识，例如 weather、data_analyse。 */
  agentKey: string;
  /** 会话唯一 ID。 */
  conversationId: string;
  /** 首条用户消息，用于生成会话标题。 */
  initialMessage?: string;
  /** 会话级元信息快照。 */
  metadata?: JsonRecord;
  /** 会话状态快照。 */
  state?: JsonRecord;
  /** 显式传入的标题，优先于自动生成。 */
  title?: string;
  /** 标题生成时附加的上下文元信息。 */
  titleMetadata?: JsonRecord;
  /** 业务用户 ID（匿名场景可为空）。 */
  userId?: number | null;
}

/**
 * 创建消息时的输入参数。
 */
export interface CreateMessageInput {
  /** 消息正文。 */
  content: string;
  /** 消息内容类型，默认 text。 */
  contentType?: AgentMessageContentType;
  /** 所属会话 ID。 */
  conversationId: string;
  /** 消息元信息。 */
  metadata?: JsonRecord;
  /** 消息角色。 */
  role: AgentMessageRole;
  /** 关联的运行 ID。 */
  runId?: string | null;
  /** 消息状态。 */
  status?: AgentMessageStatus;
}

/**
 * 创建运行记录时的输入参数。
 */
export interface CreateRunInput {
  /** 业务 Agent 标识。 */
  agentKey: string;
  /** 所属会话 ID。 */
  conversationId: string;
  /** 运行输入快照。 */
  input?: JsonRecord;
  /** 本轮使用模型名称。 */
  model?: string | null;
  /** 上游提供方名称。 */
  provider?: string | null;
  /** 关联的用户消息 ID。 */
  userMessageId?: string | null;
}

/**
 * 完成运行时的输入参数。
 */
export interface CompleteRunInput {
  /** 关联的助手消息 ID。 */
  assistantMessageId?: string | null;
  /** 结构化输出快照。 */
  output?: JsonRecord;
  /** 运行 ID。 */
  runId: string;
}

/**
 * 失败运行时的输入参数。
 */
export interface FailRunInput {
  /** 错误对象快照。 */
  error: JsonRecord;
  /** 运行 ID。 */
  runId: string;
}

/**
 * 更新会话状态时的输入参数。
 */
export interface UpdateConversationStateInput {
  /** 会话 ID。 */
  conversationId: string;
  /** 最新会话状态。 */
  state: JsonRecord;
}

/**
 * 创建产物时的输入参数。
 */
export interface CreateArtifactInput {
  /** 产物类型。 */
  artifactType: AgentArtifactType;
  /** 所属会话 ID。 */
  conversationId: string;
  /** 产物数据主体。 */
  data?: JsonRecord;
  /** 关联的消息 ID。 */
  messageId?: string | null;
  /** 产物元信息。 */
  metadata?: JsonRecord;
  /** 关联的运行 ID。 */
  runId?: string | null;
  /** 外部存储地址。 */
  storageUrl?: string | null;
  /** 产物展示标题。 */
  title?: string | null;
}

/**
 * 更新消息时的输入参数。
 */
export interface UpdateMessageInput {
  /** 新消息内容。 */
  content?: string;
  /** 待更新消息 ID。 */
  messageId: string;
  /** 新消息元信息。 */
  metadata?: JsonRecord;
  /** 新关联运行 ID。 */
  runId?: string | null;
  /** 新消息状态。 */
  status?: AgentMessageStatus;
}
