import { Controller, Get, Query } from '@nestjs/common';
import { WeatherService } from './weather.service';
import type {
  WeatherAgentResponse,
  WeatherAgentStatus,
} from './weather.service';

@Controller('weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  /**
   * Returns weather agent integration status.
   *
   * @returns Weather agent configuration status.
   */
  @Get('status')
  getStatus(): WeatherAgentStatus {
    return this.weatherService.getStatus();
  }

  /**
   * Queries weather from a natural language request.
   *
   * @param message Natural language weather request.
   * @returns Weather agent response.
   */
  @Get('query')
  async query(
    @Query('message') message?: string,
  ): Promise<WeatherAgentResponse> {
    return this.weatherService.query(message ?? '');
  }
}
