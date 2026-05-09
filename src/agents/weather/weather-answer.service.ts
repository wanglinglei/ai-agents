import { Injectable } from '@nestjs/common';
import type { StreamChunkHandler } from '../../common/langchain';
import { StreamAnswerService } from '../../common/langchain';
import {
  buildWeatherAnswerSystemPrompt,
  buildWeatherClarificationSystemPrompt,
} from './prompts/weather-agent.prompt';
import type { WeatherResult } from './tools/weather.tool';
import type {
  WeatherForecastDay,
  WeatherIntent,
} from './types/weather-agent.types';
import {
  getChatModelMessage,
  stringifyMessageContent,
} from './utils/weather-agent.utils';
import { WeatherModelService } from './weather-model.service';

type WeatherAnswerChunkHandler = StreamChunkHandler;

/**
 * weather 回答生成服务。
 */
@Injectable()
export class WeatherAnswerService {
  constructor(
    private readonly weatherModelService: WeatherModelService,
    private readonly streamAnswerService: StreamAnswerService,
  ) {}

  /**
   * 根据用户需求和缺失信息生成自然追问回答。
   *
   * @param message 用户原始问题。
   * @param apiKey OpenAI 兼容 API Key。
   * @param intent 已解析的部分天气意图。
   * @param missingParams 缺失的天气查询参数。
   * @param agentAnswer 工具调用型 Agent 生成的追问草稿。
   * @returns 自然语言追问回答。
   */
  async generateClarificationAnswer(
    message: string,
    apiKey: string,
    intent: Partial<WeatherIntent>,
    missingParams: string[],
    agentAnswer: string,
  ): Promise<string> {
    const model = this.weatherModelService.createChatModel(apiKey, 0.3);
    const result = await model.invoke(
      [
        {
          content: buildWeatherClarificationSystemPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify({
            agentAnswer,
            intent,
            missingParams,
            userQuestion: message,
          }),
          role: 'user',
        },
      ],
      this.weatherModelService.createWeatherDebugRunConfig(
        'weather.clarification.invoke',
        {
          missingParams,
          phase: 'clarification',
        },
      ),
    );

    return getChatModelMessage(result) || agentAnswer;
  }

  /**
   * 以流式方式生成自然追问回答。
   *
   * @param message 用户原始问题。
   * @param apiKey OpenAI 兼容 API Key。
   * @param intent 已解析的部分天气意图。
   * @param missingParams 缺失的天气查询参数。
   * @param agentAnswer 工具调用型 Agent 生成的追问草稿。
   * @param onChunk 每次收到模型文本片段时触发的回调。
   * @returns 完整自然语言追问回答。
   */
  async generateClarificationAnswerStream(
    message: string,
    apiKey: string,
    intent: Partial<WeatherIntent>,
    missingParams: string[],
    agentAnswer: string,
    onChunk: WeatherAnswerChunkHandler,
  ): Promise<string> {
    const model = this.weatherModelService.createChatModel(apiKey, 0.3);
    const answer = await this.streamAnswerService.streamAndCollect({
      extractText: stringifyMessageContent,
      messages: [
        {
          content: buildWeatherClarificationSystemPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify({
            agentAnswer,
            intent,
            missingParams,
            userQuestion: message,
          }),
          role: 'user',
        },
      ],
      model,
      onChunk,
      runConfig: this.weatherModelService.createWeatherDebugRunConfig(
        'weather.clarification.stream',
        {
          missingParams,
          phase: 'clarification',
        },
      ),
    });

    if (answer) {
      return answer;
    }

    await onChunk(agentAnswer);
    return agentAnswer;
  }

  /**
   * 根据用户请求和天气数据生成贴合需求的回答。
   *
   * @param message 用户原始问题。
   * @param apiKey OpenAI 兼容 API Key。
   * @param intent 已解析的天气意图。
   * @param weather 标准化后的天气结果。
   * @param forecast 请求日期对应的预报数据。
   * @param agentAnswer 工具调用型 Agent 生成的回答草稿。
   * @returns 贴合用户需求的自然语言回答。
   */
  async generateDemandAwareAnswer(
    message: string,
    apiKey: string,
    intent: WeatherIntent,
    weather: WeatherResult,
    forecast: WeatherForecastDay | undefined,
    agentAnswer: string,
  ): Promise<string> {
    const model = this.weatherModelService.createChatModel(apiKey, 0.3);
    const result = await model.invoke(
      [
        {
          content: buildWeatherAnswerSystemPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify({
            agentAnswer,
            forecast,
            intent,
            userQuestion: message,
            weather,
          }),
          role: 'user',
        },
      ],
      this.weatherModelService.createWeatherDebugRunConfig(
        'weather.answer.invoke',
        {
          city: intent.city,
          date: intent.date,
          phase: 'answer',
        },
      ),
    );

    return getChatModelMessage(result);
  }

  /**
   * 以流式方式根据用户请求和天气数据生成贴合需求的回答。
   *
   * @param message 用户原始问题。
   * @param apiKey OpenAI 兼容 API Key。
   * @param intent 已解析的天气意图。
   * @param weather 标准化后的天气结果。
   * @param forecast 请求日期对应的预报数据。
   * @param agentAnswer 工具调用型 Agent 生成的回答草稿。
   * @param onChunk 每次收到模型文本片段时触发的回调。
   * @returns 完整自然语言回答。
   */
  async generateDemandAwareAnswerStream(
    message: string,
    apiKey: string,
    intent: WeatherIntent,
    weather: WeatherResult,
    forecast: WeatherForecastDay | undefined,
    agentAnswer: string,
    onChunk: WeatherAnswerChunkHandler,
  ): Promise<string> {
    const model = this.weatherModelService.createChatModel(apiKey, 0.3);
    return this.streamAnswerService.streamAndCollect({
      extractText: stringifyMessageContent,
      messages: [
        {
          content: buildWeatherAnswerSystemPrompt(),
          role: 'system',
        },
        {
          content: JSON.stringify({
            agentAnswer,
            forecast,
            intent,
            userQuestion: message,
            weather,
          }),
          role: 'user',
        },
      ],
      model,
      onChunk,
      runConfig: this.weatherModelService.createWeatherDebugRunConfig(
        'weather.answer.stream',
        {
          city: intent.city,
          date: intent.date,
          phase: 'answer',
        },
      ),
    });
  }
}
