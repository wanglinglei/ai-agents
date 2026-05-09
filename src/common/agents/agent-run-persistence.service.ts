import { Injectable } from '@nestjs/common';
import { AgentPersistenceService } from '../../agents/persistence/agent-persistence.service';
import {
  AGENT_MESSAGE_ROLE,
  AGENT_MESSAGE_STATUS,
} from './agent-run.constants';
import type {
  PersistFailedRunInput,
  PersistSuccessfulRunInput,
} from './agent-run-persistence.types';

/**
 * Agent 运行结果通用持久化服务。
 */
@Injectable()
export class AgentRunPersistenceService {
  constructor(private readonly agentPersistence: AgentPersistenceService) {}

  /**
   * 持久化成功运行：消息、可选产物和完成态 run。
   *
   * @param input 成功运行持久化参数。
   * @returns 产物 ID（存在时）。
   */
  async persistSuccessfulRun(
    input: PersistSuccessfulRunInput,
  ): Promise<string | undefined> {
    const assistantMessage = await this.agentPersistence.createMessage({
      content: input.answer,
      conversationId: input.conversationId,
      metadata: input.messageMetadata,
      role: AGENT_MESSAGE_ROLE.ASSISTANT,
      runId: input.runId,
      status: input.messageStatus ?? AGENT_MESSAGE_STATUS.COMPLETED,
    });

    let artifactId: string | undefined;

    if (input.artifact) {
      const artifact = await this.agentPersistence.createArtifact({
        artifactType: input.artifact.artifactType,
        conversationId: input.conversationId,
        data: input.artifact.data,
        messageId: assistantMessage.id,
        metadata: input.artifact.metadata,
        runId: input.runId,
        storageUrl: input.artifact.storageUrl,
        title: input.artifact.title,
      });
      artifactId = artifact.id;

      if (input.artifactMessageMetadataKey) {
        await this.agentPersistence.updateMessage({
          messageId: assistantMessage.id,
          metadata: {
            ...assistantMessage.metadata,
            [input.artifactMessageMetadataKey]: artifact.id,
          },
        });
      }
    }

    if (input.completeRun ?? true) {
      const output = input.buildOutput?.(artifactId) ??
        input.output ?? {
          artifactId,
        };

      await this.agentPersistence.completeRun({
        assistantMessageId: assistantMessage.id,
        output,
        runId: input.runId,
      });
    }

    return artifactId;
  }

  /**
   * 持久化失败运行：失败消息和失败态 run。
   *
   * @param input 失败运行持久化参数。
   */
  async persistFailedRun(input: PersistFailedRunInput): Promise<void> {
    const assistantMessage = await this.agentPersistence.createMessage({
      content: input.answer,
      conversationId: input.conversationId,
      metadata: input.messageMetadata,
      role: AGENT_MESSAGE_ROLE.ASSISTANT,
      runId: input.runId,
      status: input.messageStatus ?? AGENT_MESSAGE_STATUS.FAILED,
    });

    await this.agentPersistence.failRun({
      error: input.error,
      runId: input.runId,
    });

    await this.agentPersistence.updateMessage({
      messageId: assistantMessage.id,
      status: AGENT_MESSAGE_STATUS.FAILED,
    });
  }
}
