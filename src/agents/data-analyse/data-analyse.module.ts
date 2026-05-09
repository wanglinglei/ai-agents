import { Module } from '@nestjs/common';
import { AgentPersistenceModule } from '../persistence/agent-persistence.module';
import { DataAnalyseController } from './data-analyse.controller';
import { DataAnalyseService } from './data-analyse.service';

@Module({
  controllers: [DataAnalyseController],
  imports: [AgentPersistenceModule],
  providers: [DataAnalyseService],
  exports: [DataAnalyseService],
})
export class DataAnalyseModule {}
