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
   * Queries weather for a city or a natural language weather request.
   *
   * @param city City name from query string.
   * @param question Optional user weather question.
   * @param message Natural language weather request.
   * @returns Weather agent response.
   */
  @Get('query')
  async query(
    @Query('city') city = '',
    @Query('question') question?: string,
    @Query('message') message?: string,
  ): Promise<WeatherAgentResponse> {
    return this.weatherService.query(city, question, message);
  }
}
