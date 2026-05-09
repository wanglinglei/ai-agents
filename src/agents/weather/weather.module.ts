import { Module } from '@nestjs/common';
import { AgentRunPersistenceService } from '../../common/agents';
import { StreamAnswerService } from '../../common/langchain';
import { AgentPersistenceModule } from '../persistence/agent-persistence.module';
import { WeatherController } from './weather.controller';
import { WeatherConversationService } from './weather-conversation.service';
import { WeatherModelService } from './weather-model.service';
import { WeatherAnswerService } from './weather-answer.service';
import { WeatherPersistenceService } from './weather-persistence.service';
import { WeatherResponseService } from './weather-response.service';
import { WeatherService } from './weather.service';

@Module({
  controllers: [WeatherController],
  imports: [AgentPersistenceModule],
  providers: [
    WeatherService,
    AgentRunPersistenceService,
    StreamAnswerService,
    WeatherConversationService,
    WeatherModelService,
    WeatherAnswerService,
    WeatherPersistenceService,
    WeatherResponseService,
  ],
  exports: [WeatherService],
})
export class WeatherModule {}
