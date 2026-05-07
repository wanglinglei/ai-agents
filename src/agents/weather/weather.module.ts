import { Module } from '@nestjs/common';
import { AgentPersistenceModule } from '../persistence/agent-persistence.module';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';

@Module({
  controllers: [WeatherController],
  imports: [AgentPersistenceModule],
  providers: [WeatherService],
  exports: [WeatherService],
})
export class WeatherModule {}
