import { BadRequestException } from '@nestjs/common';
import type { WeatherResult } from '../tools/weather.tool';
import type {
  WeatherAgentRunResult,
  WeatherIntent,
} from '../types/weather-agent.types';
import {
  getStringArrayValue,
  getStringValue,
  isRecord,
} from './weather-agent.utils';

/**
 * 校验用于天气意图解析的模型输出。
 *
 * @param value 已解析的模型 JSON 值。
 * @returns 有效的天气意图。
 */
function validateWeatherIntent(value: unknown): WeatherIntent {
  if (!isRecord(value)) {
    throw new BadRequestException('Weather intent must be a JSON object.');
  }

  const city = getStringValue(value, 'city');
  const date = getStringValue(value, 'date');
  const dateText = getStringValue(value, 'dateText') || date;
  const demand = getStringValue(value, 'demand');

  if (!city) {
    throw new BadRequestException('Unable to identify weather query city.');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestException('Unable to identify weather query date.');
  }

  return { city, date, dateText, ...(demand ? { demand } : {}) };
}

/**
 * 从追问响应中读取部分天气意图。
 *
 * @param value 已解析的模型意图值。
 * @returns 部分天气意图。
 */
function validatePartialWeatherIntent(value: unknown): Partial<WeatherIntent> {
  if (!isRecord(value)) {
    return {};
  }

  const city = getStringValue(value, 'city');
  const date = getStringValue(value, 'date');
  const dateText = getStringValue(value, 'dateText');
  const demand = getStringValue(value, 'demand');

  return {
    ...(city ? { city } : {}),
    ...(date ? { date } : {}),
    ...(dateText ? { dateText } : {}),
    ...(demand ? { demand } : {}),
  };
}

/**
 * 校验结构化天气 Agent 响应。
 *
 * @param value 已解析的 Agent JSON 值。
 * @returns 有效的天气 Agent 结果。
 */
export function validateWeatherAgentResult(
  value: unknown,
): WeatherAgentRunResult {
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
      intent: validatePartialWeatherIntent(value.intent),
      missingParams: missingParams.length ? missingParams : ['city'],
    };
  }

  const intent = validateWeatherIntent(value.intent);

  if (action === 'reuse') {
    return {
      action,
      answer,
      intent,
    };
  }

  if (!isRecord(value.weather)) {
    throw new BadRequestException('Weather agent result must include weather.');
  }

  return {
    action: 'answer',
    answer,
    intent,
    weather: value.weather as unknown as WeatherResult,
  };
}
