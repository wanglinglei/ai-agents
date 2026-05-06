import { BadRequestException, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent } from 'langchain';
import { buildWeatherAgentSystemPrompt } from './prompts/weather-agent.prompt';
import { cityLookupTool } from './tools/city-lookup.tool';
import { weatherTool } from './tools/weather.tool';
import type { WeatherResult } from './tools/weather.tool';

export interface WeatherIntent {
  city: string;
  date: string;
  dateText: string;
}

export interface WeatherAgentStatus {
  hasApiKey: boolean;
  integrated: boolean;
  model: string;
  provider: string;
}

export interface WeatherAgentResponse {
  answer: string;
  city: string;
  date: string;
  dateText: string;
  intent: WeatherIntent;
  model: string | null;
  question: string;
  weather: WeatherResult;
}

type WeatherForecastDay = WeatherResult['forecast'][number];

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
 * Builds a natural language weather query from optional request fields.
 *
 * @param city Optional city query parameter.
 * @param question Optional user weather question.
 * @param message Optional natural language weather request.
 * @returns Normalized weather query text.
 */
function buildWeatherQueryText(
  city: string,
  question?: string,
  message?: string,
): string {
  const naturalLanguageRequest = message?.trim() || question?.trim();
  const trimmedCity = city.trim();

  if (naturalLanguageRequest) {
    return naturalLanguageRequest;
  }

  if (trimmedCity) {
    return `请查询${trimmedCity}今天的天气，并给出出行建议。`;
  }

  return '';
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
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      provider: 'QWeather',
    };
  }

  /**
   * Queries weather data and generates a concise user-facing answer.
   *
   * @param city City name from query string.
   * @param question Optional user question about the weather.
   * @param message Optional natural language weather request.
   * @returns Weather data and generated answer.
   */
  async query(
    city: string,
    question?: string,
    message?: string,
  ): Promise<WeatherAgentResponse> {
    const normalizedQuestion = buildWeatherQueryText(city, question, message);

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

    const agentResult = await this.runWeatherAgent(message, apiKey);
    const intent = agentResult.intent;
    const weather = agentResult.weather;
    const forecast = this.findForecastByDate(weather, intent.date);

    return {
      answer:
        agentResult.answer ||
        this.buildFallbackAnswer(weather, intent, forecast),
      city: intent.city,
      date: intent.date,
      dateText: intent.dateText,
      intent,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      question: message,
      weather,
    };
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
  ): Promise<{
    answer: string;
    intent: WeatherIntent;
    weather: WeatherResult;
  }> {
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
   * Validates the structured weather agent response.
   *
   * @param value Parsed agent JSON value.
   * @returns Valid weather agent result.
   */
  private validateWeatherAgentResult(value: unknown): {
    answer: string;
    intent: WeatherIntent;
    weather: WeatherResult;
  } {
    if (!isRecord(value)) {
      throw new BadRequestException('Weather agent result must be an object.');
    }

    const intent = this.validateWeatherIntent(value.intent);

    if (!isRecord(value.weather)) {
      throw new BadRequestException(
        'Weather agent result must include weather.',
      );
    }

    return {
      answer: getStringValue(value, 'answer'),
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
   * Builds a deterministic answer when OpenAI is not configured.
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
