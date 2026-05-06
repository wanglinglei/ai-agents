import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { WeatherService } from './weather.service';
import type {
  WeatherAgentResponse,
  WeatherAgentStatus,
} from './weather.service';

export interface WeatherQueryBody {
  conversationId?: string;
  message?: string;
}

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
   * Queries weather from a natural language request with conversation context.
   *
   * @param body Weather query request body.
   * @returns Weather agent response.
   */
  @Post('query')
  async queryByPost(
    @Body() body: WeatherQueryBody,
  ): Promise<WeatherAgentResponse> {
    return this.weatherService.query(body.message ?? '', body.conversationId);
  }
}
