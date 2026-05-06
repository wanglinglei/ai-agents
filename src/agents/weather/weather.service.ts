import { BadRequestException, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent } from 'langchain';
import {
  buildWeatherAgentSystemPrompt,
  buildWeatherAnswerSystemPrompt,
  buildWeatherClarificationSystemPrompt,
} from './prompts/weather-agent.prompt';
import { cityLookupTool } from './tools/city-lookup.tool';
import { weatherTool } from './tools/weather.tool';
import type { WeatherResult } from './tools/weather.tool';

export interface WeatherIntent {
  city: string;
  date: string;
  dateText: string;
}

export type WeatherAgentResponseStatus =
  | 'failed'
  | 'need_clarification'
  | 'success';

export interface WeatherAgentStatus {
  hasApiKey: boolean;
  integrated: boolean;
  model: string;
  provider: string;
}

export interface WeatherAgentResponse {
  answer: string;
  city?: string;
  date?: string;
  dateText?: string;
  intent?: WeatherIntent;
  missingParams?: string[];
  model: string | null;
  partialIntent?: Partial<WeatherIntent>;
  question: string;
  status: WeatherAgentResponseStatus;
  weather?: WeatherResult;
}

type WeatherForecastDay = WeatherResult['forecast'][number];
type WeatherAgentRunResult =
  | {
      action: 'answer';
      answer: string;
      intent: WeatherIntent;
      weather: WeatherResult;
    }
  | {
      action: 'clarify';
      answer: string;
      intent: Partial<WeatherIntent>;
      missingParams: string[];
    };

/**
 * Checks whether a value is a plain object record.
 *
 * @param value Value to inspect.
 * @returns True when the value can be read as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a string value from a record.
 *
 * @param record Source record.
 * @param key Property name to read.
 * @returns String value, or an empty string.
 */
function getStringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Reads a string array value from a record.
 *
 * @param record Source record.
 * @param key Property name to read.
 * @returns String array value, or an empty array.
 */
function getStringArrayValue(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Extracts a JSON object string from model output.
 *
 * @param output Raw model output.
 * @returns JSON object string.
 */
function extractJsonObject(output: string): string {
  const normalizedOutput = output
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const startIndex = normalizedOutput.indexOf('{');
  const endIndex = normalizedOutput.lastIndexOf('}');

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new BadRequestException('Failed to parse weather intent.');
  }

  return normalizedOutput.slice(startIndex, endIndex + 1);
}

/**
 * Converts a LangChain message content value into plain text.
 *
 * @param value Message content value.
 * @returns Plain text content.
 */
function stringifyMessageContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }

      if (isRecord(item)) {
        return getStringValue(item, 'text');
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Reads the final assistant message text from a LangChain agent result.
 *
 * @param result Agent invoke result.
 * @returns Final assistant message content.
 */
function getFinalAgentMessage(result: unknown): string {
  if (!isRecord(result)) {
    return '';
  }

  const output = result.output;

  if (typeof output === 'string') {
    return output;
  }

  const messages: unknown = result.messages;

  if (!Array.isArray(messages)) {
    return '';
  }

  const lastMessage: unknown = messages[messages.length - 1];

  if (!isRecord(lastMessage)) {
    return '';
  }

  return stringifyMessageContent(lastMessage.content);
}

/**
 * Reads plain text content from a chat model result.
 *
 * @param result Chat model invoke result.
 * @returns Plain text model output.
 */
function getChatModelMessage(result: unknown): string {
  if (!isRecord(result)) {
    return '';
  }

  return stringifyMessageContent(result.content).trim();
}

/**
 * Formats a date as a local YYYY-MM-DD string.
 *
 * @param date Date to format.
 * @returns Local date string.
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Checks whether QWeather authentication is configured.
 *
 * @returns True when a supported QWeather token variable exists.
 */
function hasQWeatherToken(): boolean {
  return Boolean(process.env.WEATHER_API_TOKEN?.trim());
}

@Injectable()
export class WeatherService {
  /**
   * Returns weather agent runtime status.
   *
   * @returns Weather agent configuration status.
   */
  getStatus(): WeatherAgentStatus {
    return {
      hasApiKey: Boolean(process.env.OPENAI_API_KEY),
      integrated: true,
      model: process.env.OPENAI_MODEL || '',
      provider: 'QWeather',
    };
  }

  /**
   * Queries weather data and generates a concise user-facing answer.
   *
   * @param message Natural language weather request.
   * @returns Weather data and generated answer.
   */
  async query(message: string): Promise<WeatherAgentResponse> {
    const normalizedQuestion = message.trim();

    if (!normalizedQuestion) {
      throw new BadRequestException('请提供天气查询内容。');
    }

    return this.queryByMessage(normalizedQuestion);
  }

  /**
   * Parses a natural language weather request before querying weather data.
   *
   * @param message Natural language user request.
   * @returns Weather agent response.
   */
  private async queryByMessage(message: string): Promise<WeatherAgentResponse> {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new BadRequestException(
        'OPENAI_API_KEY is required to parse natural language weather requests.',
      );
    }

    if (!hasQWeatherToken()) {
      throw new BadRequestException(
        'QWeather token is required. Set WEATHER_API_TOKEN.',
      );
    }

    try {
      const agentResult = await this.runWeatherAgent(message, apiKey);

      if (agentResult.action === 'clarify') {
        const answer = await this.generateClarificationAnswer(
          message,
          apiKey,
          agentResult.intent,
          agentResult.missingParams,
          agentResult.answer,
        );

        return {
          answer,
          city: agentResult.intent.city,
          date: agentResult.intent.date,
          dateText: agentResult.intent.dateText,
          missingParams: agentResult.missingParams,
          model: process.env.OPENAI_MODEL ?? 'qw-plus',
          partialIntent: agentResult.intent,
          question: message,
          status: 'need_clarification',
        };
      }

      const intent = agentResult.intent;
      const weather = agentResult.weather;
      const forecast = this.findForecastByDate(weather, intent.date);
      const answer =
        (await this.generateDemandAwareAnswer(
          message,
          apiKey,
          intent,
          weather,
          forecast,
          agentResult.answer,
        )) || this.buildFallbackAnswer(weather, intent, forecast);

      return {
        answer,
        city: intent.city,
        date: intent.date,
        dateText: intent.dateText,
        intent,
        model: process.env.OPENAI_MODEL ?? 'qw-plus',
        question: message,
        status: 'success',
        weather,
      };
    } catch (error) {
      return {
        answer: this.buildApiFailureAnswer(message, error),
        model: process.env.OPENAI_MODEL ?? 'qw-plus',
        question: message,
        status: 'failed',
      };
    }
  }

  /**
   * Runs the tool-calling weather agent for a natural language request.
   *
   * @param message Natural language weather request.
   * @param apiKey OpenAI API key.
   * @returns Parsed intent, weather data, and final answer.
   */
  private async runWeatherAgent(
    message: string,
    apiKey: string,
  ): Promise<WeatherAgentRunResult> {
    const today = formatLocalDate(new Date());
    const agent = createAgent({
      model: new ChatOpenAI({
        apiKey,
        model: process.env.OPENAI_MODEL,
        temperature: 0,
        configuration: {
          baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        },
      }),
      systemPrompt: buildWeatherAgentSystemPrompt(today),
      tools: [cityLookupTool, weatherTool],
    });
    const result = await agent.invoke({
      messages: [
        {
          content: `用户输入：${message}`,
          role: 'user',
        },
      ],
    });
    const output = getFinalAgentMessage(result);

    if (!output) {
      throw new BadRequestException(
        'Weather agent returned an empty response.',
      );
    }

    return this.validateWeatherAgentResult(
      JSON.parse(extractJsonObject(output)),
    );
  }

  /**
   * Validates model output for weather intent parsing.
   *
   * @param value Parsed model JSON value.
   * @returns Valid weather intent.
   */
  private validateWeatherIntent(value: unknown): WeatherIntent {
    if (!isRecord(value)) {
      throw new BadRequestException('Weather intent must be a JSON object.');
    }

    const city = getStringValue(value, 'city');
    const date = getStringValue(value, 'date');
    const dateText = getStringValue(value, 'dateText') || date;

    if (!city) {
      throw new BadRequestException('Unable to identify weather query city.');
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Unable to identify weather query date.');
    }

    return { city, date, dateText };
  }

  /**
   * Reads a partial weather intent from a clarification response.
   *
   * @param value Parsed model intent value.
   * @returns Partial weather intent.
   */
  private validatePartialWeatherIntent(value: unknown): Partial<WeatherIntent> {
    if (!isRecord(value)) {
      return {};
    }

    const city = getStringValue(value, 'city');
    const date = getStringValue(value, 'date');
    const dateText = getStringValue(value, 'dateText');

    return {
      ...(city ? { city } : {}),
      ...(date ? { date } : {}),
      ...(dateText ? { dateText } : {}),
    };
  }

  /**
   * Validates the structured weather agent response.
   *
   * @param value Parsed agent JSON value.
   * @returns Valid weather agent result.
   */
  private validateWeatherAgentResult(value: unknown): WeatherAgentRunResult {
    if (!isRecord(value)) {
      throw new BadRequestException('Weather agent result must be an object.');
    }

    const action = getStringValue(value, 'action');
    const answer = getStringValue(value, 'answer');

    if (action === 'clarify') {
      const missingParams = getStringArrayValue(value, 'missingParams');

      return {
        action,
        answer,
        intent: this.validatePartialWeatherIntent(value.intent),
        missingParams: missingParams.length ? missingParams : ['city'],
      };
    }

    const intent = this.validateWeatherIntent(value.intent);

    if (!isRecord(value.weather)) {
      throw new BadRequestException(
        'Weather agent result must include weather.',
      );
    }

    return {
      action: 'answer',
      answer,
      intent,
      weather: value.weather as unknown as WeatherResult,
    };
  }

  /**
   * Finds provider forecast data for a target date.
   *
   * @param weather Normalized weather result.
   * @param date Target date in YYYY-MM-DD format.
   * @returns Forecast for the target date when available.
   */
  private findForecastByDate(
    weather: WeatherResult,
    date: string,
  ): WeatherForecastDay | undefined {
    return weather.forecast.find((forecast) => forecast.date === date);
  }

  /**
   * Builds a stable fallback answer when the provider request fails.
   *
   * @param message Original user question.
   * @param error Weather query error.
   * @returns User-facing failure answer.
   */
  private buildApiFailureAnswer(message: string, error: unknown): string {
    const reason = error instanceof Error ? error.message : '';
    const normalizedReason = reason ? `（${reason}）` : '';

    return `抱歉，刚才查询天气服务失败${normalizedReason}。你可以稍后再试，或换一个更明确的城市名称重新查询。原始问题：${message}`;
  }

  /**
   * Generates a natural clarification answer from user demand and missing data.
   *
   * @param message Original user question.
   * @param apiKey OpenAI compatible API key.
   * @param intent Partially parsed weather intent.
   * @param missingParams Missing weather query parameters.
   * @param agentAnswer Clarification drafted by the tool-calling agent.
   * @returns Natural clarification answer.
   */
  private async generateClarificationAnswer(
    message: string,
    apiKey: string,
    intent: Partial<WeatherIntent>,
    missingParams: string[],
    agentAnswer: string,
  ): Promise<string> {
    const model = new ChatOpenAI({
      apiKey,
      model: process.env.OPENAI_MODEL,
      temperature: 0.3,
      configuration: {
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
    });
    const result = await model.invoke([
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
    ]);

    return getChatModelMessage(result) || agentAnswer;
  }

  /**
   * Generates a demand-aware answer from the user request and weather data.
   *
   * @param message Original user question.
   * @param apiKey OpenAI compatible API key.
   * @param intent Parsed weather intent.
   * @param weather Normalized weather result.
   * @param forecast Forecast for the requested date.
   * @param agentAnswer Answer drafted by the tool-calling agent.
   * @returns Natural language answer tailored to the user's demand.
   */
  private async generateDemandAwareAnswer(
    message: string,
    apiKey: string,
    intent: WeatherIntent,
    weather: WeatherResult,
    forecast: WeatherForecastDay | undefined,
    agentAnswer: string,
  ): Promise<string> {
    const model = new ChatOpenAI({
      apiKey,
      model: process.env.OPENAI_MODEL,
      temperature: 0.3,
      configuration: {
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
    });
    const result = await model.invoke([
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
    ]);

    return getChatModelMessage(result);
  }

  /**
   * Builds a deterministic answer when the model answer is unavailable.
   *
   * @param weather Normalized weather result.
   * @param intent Parsed weather intent.
   * @param forecast Forecast for the target date when available.
   * @returns Concise fallback weather answer.
   */
  private buildFallbackAnswer(
    weather: WeatherResult,
    intent: WeatherIntent,
    forecast: WeatherForecastDay | undefined,
  ): string {
    const current = weather.current;
    const forecastText = forecast
      ? `${intent.dateText}预计 ${forecast.minTemperature.celsius}°C 到 ${forecast.maxTemperature.celsius}°C。`
      : `当前数据源暂未覆盖 ${intent.dateText} 的预报。`;

    return `${intent.city}${intent.dateText}天气查询结果：${weather.resolvedCity}当前${current.description || '天气数据可用'}，气温 ${current.temperature.celsius}°C，体感 ${current.feelsLike.celsius}°C，湿度 ${current.humidity}%，风向 ${current.windDirection || '未知'}，风速 ${current.windSpeedKmph || '未知'} km/h。${forecastText}`;
  }
}
