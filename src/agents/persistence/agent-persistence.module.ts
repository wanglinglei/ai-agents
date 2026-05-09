import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentPersistenceService } from './agent-persistence.service';
import { ConversationTitleService } from './conversation-title.service';
import { AgentArtifact } from './entities/agent-artifact.entity';
import { AgentConversation } from './entities/agent-conversation.entity';
import { AgentDefinition } from './entities/agent-definition.entity';
import { AgentMessage } from './entities/agent-message.entity';
import { AgentRun } from './entities/agent-run.entity';
import { AgentToolCall } from './entities/agent-tool-call.entity';

@Module({
  exports: [AgentPersistenceService],
  imports: [
    TypeOrmModule.forFeature([
      AgentArtifact,
      AgentConversation,
      AgentDefinition,
      AgentMessage,
      AgentRun,
      AgentToolCall,
    ]),
  ],
  providers: [AgentPersistenceService, ConversationTitleService],
})
export class AgentPersistenceModule {}
