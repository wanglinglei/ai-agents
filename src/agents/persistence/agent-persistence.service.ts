import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentArtifact } from './entities/agent-artifact.entity';
import { AgentConversation } from './entities/agent-conversation.entity';
import { AgentMessage } from './entities/agent-message.entity';
import { AgentRun } from './entities/agent-run.entity';

interface EnsureConversationInput {
  agentKey: string;
  conversationId: string;
  metadata?: Record<string, unknown>;
  state?: Record<string, unknown>;
  title?: string;
  userId?: number | null;
}

interface CreateMessageInput {
  content: string;
  contentType?: string;
  conversationId: string;
  metadata?: Record<string, unknown>;
  role: string;
  runId?: string | null;
  status?: string;
}

interface CreateRunInput {
  agentKey: string;
  conversationId: string;
  input?: Record<string, unknown>;
  model?: string | null;
  provider?: string | null;
  userMessageId?: string | null;
}

interface CompleteRunInput {
  assistantMessageId?: string | null;
  output?: Record<string, unknown>;
  runId: string;
}

interface FailRunInput {
  error: Record<string, unknown>;
  runId: string;
}

interface UpdateConversationStateInput {
  conversationId: string;
  state: Record<string, unknown>;
}

interface CreateArtifactInput {
  artifactType: string;
  conversationId: string;
  data?: Record<string, unknown>;
  messageId?: string | null;
  metadata?: Record<string, unknown>;
  runId?: string | null;
  storageUrl?: string | null;
  title?: string | null;
}

interface UpdateMessageInput {
  content?: string;
  messageId: string;
  metadata?: Record<string, unknown>;
  runId?: string | null;
  status?: string;
}

/**
 * 通用 Agent 持久化服务，封装会话、消息、运行和产物的基础读写。
 */
@Injectable()
export class AgentPersistenceService {
  constructor(
    @InjectRepository(AgentArtifact)
    private readonly artifactRepository: Repository<AgentArtifact>,
    @InjectRepository(AgentConversation)
    private readonly conversationRepository: Repository<AgentConversation>,
    @InjectRepository(AgentMessage)
    private readonly messageRepository: Repository<AgentMessage>,
    @InjectRepository(AgentRun)
    private readonly runRepository: Repository<AgentRun>,
  ) {}

  /**
   * 读取或创建指定 Agent 会话。
   *
   * @param input 会话创建或读取参数。
   * @returns 可用的会话记录。
   */
  async ensureConversation(
    input: EnsureConversationInput,
  ): Promise<AgentConversation> {
    const existing = await this.conversationRepository.findOne({
      where: {
        agentKey: input.agentKey,
        id: input.conversationId,
      },
    });

    if (existing) {
      return existing;
    }

    return this.conversationRepository.save(
      this.conversationRepository.create({
        agentKey: input.agentKey,
        id: input.conversationId,
        lastMessageAt: null,
        metadata: input.metadata ?? {},
        state: input.state ?? {},
        title: input.title ?? null,
        userId: input.userId ?? null,
      }),
    );
  }

  /**
   * 创建一条 Agent 消息。
   *
   * @param input 消息内容和关联上下文。
   * @returns 已保存的消息。
   */
  async createMessage(input: CreateMessageInput): Promise<AgentMessage> {
    return this.messageRepository.save(
      this.messageRepository.create({
        content: input.content,
        contentType: input.contentType ?? 'text',
        conversationId: input.conversationId,
        metadata: input.metadata ?? {},
        role: input.role,
        runId: input.runId ?? null,
        status: input.status ?? 'completed',
      }),
    );
  }

  /**
   * 创建一次 Agent 运行记录。
   *
   * @param input 运行输入快照和模型信息。
   * @returns 已保存的运行记录。
   */
  async createRun(input: CreateRunInput): Promise<AgentRun> {
    return this.runRepository.save(
      this.runRepository.create({
        agentKey: input.agentKey,
        conversationId: input.conversationId,
        input: input.input ?? {},
        model: input.model ?? null,
        provider: input.provider ?? null,
        startedAt: new Date(),
        status: 'running',
        userMessageId: input.userMessageId ?? null,
      }),
    );
  }

  /**
   * 将 Agent 运行标记为完成。
   *
   * @param input 运行 ID 和最终结构化输出。
   * @returns 更新后的运行记录。
   */
  async completeRun(input: CompleteRunInput): Promise<AgentRun | null> {
    const run = await this.runRepository.findOne({ where: { id: input.runId } });

    if (!run) {
      return null;
    }

    run.assistantMessageId = input.assistantMessageId ?? null;
    run.completedAt = new Date();
    run.output = input.output ?? {};
    run.status = 'completed';

    return this.runRepository.save(run);
  }

  /**
   * 将 Agent 运行标记为失败。
   *
   * @param input 运行 ID 和错误信息。
   * @returns 更新后的运行记录。
   */
  async failRun(input: FailRunInput): Promise<AgentRun | null> {
    const run = await this.runRepository.findOne({ where: { id: input.runId } });

    if (!run) {
      return null;
    }

    run.completedAt = new Date();
    run.error = input.error;
    run.status = 'failed';

    return this.runRepository.save(run);
  }

  /**
   * 读取会话状态。
   *
   * @param agentKey Agent 业务标识。
   * @param conversationId 会话 ID。
   * @returns 会话状态，不存在时返回 undefined。
   */
  async getConversationState<TState extends object>(
    agentKey: string,
    conversationId: string,
  ): Promise<TState | undefined> {
    const conversation = await this.conversationRepository.findOne({
      where: {
        agentKey,
        id: conversationId,
      },
    });

    return conversation?.state as TState | undefined;
  }

  /**
   * 更新会话状态和最近消息时间。
   *
   * @param input 会话 ID 和状态快照。
   * @returns 更新后的会话记录。
   */
  async updateConversationState(
    input: UpdateConversationStateInput,
  ): Promise<AgentConversation | null> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: input.conversationId },
    });

    if (!conversation) {
      return null;
    }

    conversation.lastMessageAt = new Date();
    conversation.state = input.state;

    return this.conversationRepository.save(conversation);
  }

  /**
   * 创建 Agent 产物记录。
   *
   * @param input 产物类型、数据和关联上下文。
   * @returns 已保存的产物。
   */
  async createArtifact(input: CreateArtifactInput): Promise<AgentArtifact> {
    return this.artifactRepository.save(
      this.artifactRepository.create({
        artifactType: input.artifactType,
        conversationId: input.conversationId,
        data: input.data ?? {},
        messageId: input.messageId ?? null,
        metadata: input.metadata ?? {},
        runId: input.runId ?? null,
        storageUrl: input.storageUrl ?? null,
        title: input.title ?? null,
      }),
    );
  }

  /**
   * 更新消息内容、状态或关联运行。
   *
   * @param input 消息更新内容。
   * @returns 更新后的消息记录。
   */
  async updateMessage(input: UpdateMessageInput): Promise<AgentMessage | null> {
    const message = await this.messageRepository.findOne({
      where: { id: input.messageId },
    });

    if (!message) {
      return null;
    }

    if (input.content !== undefined) {
      message.content = input.content;
    }

    if (input.metadata) {
      message.metadata = input.metadata;
    }

    if (input.runId !== undefined) {
      message.runId = input.runId;
    }

    if (input.status) {
      message.status = input.status;
    }

    return this.messageRepository.save(message);
  }
}
