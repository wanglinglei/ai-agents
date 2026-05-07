import type { WeatherResult } from '../tools/weather.tool';
import type {
  WeatherAgentResponse,
  WeatherForecastDay,
  WeatherIntent,
} from '../types/weather-agent.types';

interface WeatherResponseModelInput {
  model: string;
}

interface WeatherClarificationResponseInput extends WeatherResponseModelInput {
  answer: string;
  conversationId: string;
  message: string;
  missingParams: string[];
  partialIntent: Partial<WeatherIntent>;
}

interface WeatherSuccessResponseInput extends WeatherResponseModelInput {
  answer: string;
  conversationId: string | undefined;
  intent: WeatherIntent;
  message: string;
  weather: WeatherResult;
}

interface WeatherFailedResponseInput extends WeatherResponseModelInput {
  answer: string;
  conversationId: string | undefined;
  message: string;
}

/**
 * 构建追问响应，保持公开 API 结构不变。
 *
 * @param input 追问响应所需的上下文和模型信息。
 * @returns 天气追问响应。
 */
export function buildClarificationResponse(
  input: WeatherClarificationResponseInput,
): WeatherAgentResponse {
  return {
    answer: input.answer,
    city: input.partialIntent.city,
    conversationId: input.conversationId,
    date: input.partialIntent.date,
    dateText: input.partialIntent.dateText,
    missingParams: input.missingParams,
    model: input.model,
    partialIntent: input.partialIntent,
    question: input.message,
    status: 'need_clarification',
  };
}

/**
 * 构建成功天气响应，保持公开 API 结构不变。
 *
 * @param input 成功响应所需的天气、意图和模型信息。
 * @returns 天气查询成功响应。
 */
export function buildSuccessResponse(
  input: WeatherSuccessResponseInput,
): WeatherAgentResponse {
  return {
    answer: input.answer,
    city: input.intent.city,
    conversationId: input.conversationId,
    date: input.intent.date,
    dateText: input.intent.dateText,
    intent: input.intent,
    model: input.model,
    question: input.message,
    status: 'success',
    weather: input.weather,
  };
}

/**
 * 构建失败天气响应，避免主流程继续抛出异常。
 *
 * @param input 失败响应所需的错误回答和模型信息。
 * @returns 天气查询失败响应。
 */
export function buildFailedResponse(
  input: WeatherFailedResponseInput,
): WeatherAgentResponse {
  return {
    answer: input.answer,
    conversationId: input.conversationId,
    model: input.model,
    question: input.message,
    status: 'failed',
  };
}

/**
 * 在天气服务请求失败时构建稳定的兜底回答。
 *
 * @param message 用户原始问题。
 * @param error 天气查询错误。
 * @returns 面向用户的失败回答。
 */
export function buildApiFailureAnswer(message: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : '';
  const normalizedReason = reason ? `（${reason}）` : '';

  return `抱歉，刚才查询天气服务失败${normalizedReason}。你可以稍后再试，或换一个更明确的城市名称重新查询。原始问题：${message}`;
}

/**
 * 在模型回答不可用时构建确定性的兜底回答。
 *
 * @param weather 标准化后的天气结果。
 * @param intent 已解析的天气意图。
 * @param forecast 可用时为目标日期的预报数据。
 * @returns 简洁的天气兜底回答。
 */
export function buildFallbackAnswer(
  weather: WeatherResult,
  intent: WeatherIntent,
  forecast: WeatherForecastDay | undefined,
): string {
  const current = weather.current;
  const demandText = intent.demand ? `，结合${intent.demand}` : '';
  const forecastText = forecast
    ? `${intent.dateText}预计 ${forecast.minTemperature.celsius}°C 到 ${forecast.maxTemperature.celsius}°C。`
    : `当前数据源暂未覆盖 ${intent.dateText} 的预报。`;

  return `${intent.city}${intent.dateText}天气查询结果${demandText}：${weather.resolvedCity}当前${current.description || '天气数据可用'}，气温 ${current.temperature.celsius}°C，体感 ${current.feelsLike.celsius}°C，湿度 ${current.humidity}%，风向 ${current.windDirection || '未知'}，风速 ${current.windSpeedKmph || '未知'} km/h。${forecastText}`;
}
