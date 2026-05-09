import { Module } from '@nestjs/common';
import { AgentRunPersistenceService } from '../../common/agents';
import { StreamAnswerService } from '../../common/langchain';
import { AgentPersistenceModule } from '../persistence/agent-persistence.module';
import { DataAnalyseController } from './data-analyse.controller';
import { DataAnalyseAnswerService } from './data-analyse-answer.service';
import { DataAnalyseExecutionService } from './data-analyse-execution.service';
import { DataAnalyseModelService } from './data-analyse-model.service';
import { DataAnalysePersistenceService } from './data-analyse-persistence.service';
import { DataAnalyseResponseService } from './data-analyse-response.service';
import { DataAnalyseService } from './data-analyse.service';

@Module({
  controllers: [DataAnalyseController],
  imports: [AgentPersistenceModule],
  providers: [
    DataAnalyseService,
    AgentRunPersistenceService,
    DataAnalyseAnswerService,
    DataAnalyseExecutionService,
    DataAnalyseModelService,
    DataAnalysePersistenceService,
    DataAnalyseResponseService,
    StreamAnswerService,
  ],
  exports: [DataAnalyseService],
})
export class DataAnalyseModule {}
