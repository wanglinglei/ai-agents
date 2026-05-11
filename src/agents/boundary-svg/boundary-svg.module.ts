import { Module } from '@nestjs/common';
import { AgentRunPersistenceService } from '../../common/agents';
import { AgentPersistenceModule } from '../persistence/agent-persistence.module';
import { BoundarySvgController } from './boundary-svg.controller';
import { BoundarySvgModelService } from './boundary-svg-model.service';
import { BoundarySvgService } from './boundary-svg.service';

@Module({
  controllers: [BoundarySvgController],
  imports: [AgentPersistenceModule],
  providers: [
    BoundarySvgService,
    BoundarySvgModelService,
    AgentRunPersistenceService,
  ],
  exports: [BoundarySvgService],
})
export class BoundarySvgModule {}
