import { Injectable } from '@nestjs/common';
import {
  AGENT_ARTIFACT_TYPE,
  AGENT_MESSAGE_STATUS,
  AgentRunPersistenceService,
} from '../../common/agents';
import type { WeatherAgentResponse } from './types/weather-agent.types';
import { WeatherModelService } from './weather-model.service';

/**
 * weather 运行结果持久化服务。
 */
@Injectable()
export class WeatherPersistenceService {
  constructor(
    private readonly runPersistence: AgentRunPersistenceService,
    private readonly weatherModelService: WeatherModelService,
  ) {}

  /**
   * 保存天气响应对应的助手消息、天气产物和运行结果。
   *
   * @param response 天气 Agent 对外响应。
   * @param runId 本次 Agent 运行 ID。
   * @param completeRun 是否将运行标记为完成。
   */
  async persistWeatherResponse(
    response: WeatherAgentResponse,
    runId: string,
    completeRun = true,
  ): Promise<void> {
    if (!response.conversationId) {
      return;
    }

    await this.runPersistence.persistSuccessfulRun({
      answer: response.answer,
      artifact: response.weather
        ? {
            artifactType: AGENT_ARTIFACT_TYPE.WEATHER_RESULT,
            data: this.weatherModelService.toJsonRecord(response.weather),
            metadata: {
              city: response.city,
              date: response.date,
              intent: response.intent,
              source: response.weather.source,
            },
            title: `${response.city ?? '未知城市'}${response.dateText ?? ''}天气结果`,
          }
        : undefined,
      artifactMessageMetadataKey: response.weather
        ? 'weatherArtifactId'
        : undefined,
      completeRun,
      conversationId: response.conversationId,
      messageMetadata: {
        city: response.city,
        date: response.date,
        dateText: response.dateText,
        intent: response.intent,
        missingParams: response.missingParams,
        model: response.model,
        partialIntent: response.partialIntent,
        status: response.status,
      },
      messageStatus:
        response.status === 'failed'
          ? AGENT_MESSAGE_STATUS.FAILED
          : AGENT_MESSAGE_STATUS.COMPLETED,
      buildOutput: (artifactId) => ({
        answer: response.answer,
        artifactId,
        intent: response.intent,
        missingParams: response.missingParams,
        partialIntent: response.partialIntent,
        status: response.status,
      }),
      runId,
    });
  }
}
