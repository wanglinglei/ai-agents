/*
 * @Author: wanglinglei
 * @Date: 2026-05-06 15:30:00
 * @Description: 天气查询工具
 * @FilePath: /agents/src/agents/weather/tools/weather.tool.ts
 */
import { DynamicTool } from '@langchain/core/tools';
import { lookupQWeatherCityId } from './city-lookup.tool';
import type { QWeatherCityLocation, QWeatherRefer } from './city-lookup.tool';

export interface WeatherToolInput {
  city: string;
  date?: string;
  dateText?: string;
  days?: QWeatherForecastDays;
  lang?: string;
  language?: string;
  locationId?: string;
  unit?: QWeatherUnit;
}

interface WeatherMetric {
  celsius: string;
  fahrenheit?: string;
}

type QWeatherForecastDays = '3d' | '7d' | '10d' | '15d' | '30d';

type QWeatherUnit = 'm' | 'i';

export interface WeatherResult {
  city: string;
  resolvedCity: string;
  country?: string;
  fxLink?: string;
  region?: string;
  locationId?: string;
  localTime?: string;
  current: {
    description: string;
    feelsLike: WeatherMetric;
    humidity: string;
    observationTime?: string;
    precipitationMm?: string;
    pressure?: string;
    temperature: WeatherMetric;
    uvIndex?: string;
    visibility?: string;
    windDirection?: string;
    windSpeedKmph?: string;
  };
  forecast: Array<{
    avgTemperature: WeatherMetric;
    dateText?: string;
    date: string;
    dayDescription?: string;
    maxTemperature: WeatherMetric;
    minTemperature: WeatherMetric;
    nightDescription?: string;
    precipitationMm?: string;
    pressure?: string;
    uvIndex?: string;
    visibility?: string;
    windDirection?: string;
    windScale?: string;
    windSpeedKmph?: string;
  }>;
  queryDate: string;
  queryType: 'daily' | 'now';
  refer?: QWeatherRefer;
  source: string;
  updateTime?: string;
}

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
 * Reads an optional array of strings from a record.
 *
 * @param record Source record.
 * @param key Property name to read.
 * @returns String array when present, otherwise undefined.
 */
function getStringArrayValue(
  record: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = record[key];

  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Reads a string value from a record.
 *
 * @param record Source record.
 * @param key Property name to read.
 * @returns String property value, or an empty string.
 */
function getStringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Reads the first text value from wttr.in translated fields.
 *
 * @param value Possible wttr.in text array.
 * @returns Text value from the first item, or an empty string.
 */
function getToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD date string as a local date.
 *
 * @param date Date string to parse.
 * @returns Parsed local date.
 */
function parseLocalDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    throw new Error('Date must use YYYY-MM-DD format.');
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Calculates the inclusive day distance from today to a target date.
 *
 * @param targetDate Target date in YYYY-MM-DD format.
 * @returns Number of days from today, where today is 0.
 */
function getDayOffset(targetDate: string): number {
  const today = parseLocalDate(getToday());
  const target = parseLocalDate(targetDate);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.round((target.getTime() - today.getTime()) / millisecondsPerDay);
}

/**
 * Selects a QWeather daily forecast window that covers the target date.
 *
 * @param targetDate Target date in YYYY-MM-DD format.
 * @returns QWeather daily forecast path parameter.
 */
function getForecastDays(targetDate: string): QWeatherForecastDays {
  const dayOffset = getDayOffset(targetDate);

  if (dayOffset < 1) {
    throw new Error('Daily forecast only supports future dates.');
  }

  if (dayOffset <= 3) {
    return '3d';
  }

  if (dayOffset <= 7) {
    return '7d';
  }

  if (dayOffset <= 10) {
    return '10d';
  }

  if (dayOffset <= 15) {
    return '15d';
  }

  if (dayOffset <= 30) {
    return '30d';
  }

  throw new Error('QWeather daily forecast supports up to 30 days.');
}

/**
 * Converts common language aliases into QWeather language codes.
 *
 * @param language Language code from caller.
 * @returns QWeather language code.
 */
function normalizeLanguage(language?: string): string | undefined {
  if (!language) {
    return undefined;
  }

  const normalizedLanguage = language.trim().toLowerCase();

  if (normalizedLanguage === 'zh-cn') {
    return 'zh';
  }

  return normalizedLanguage;
}

/**
 * Parses LangChain tool input into a weather query.
 *
 * @param input Raw city name or JSON string containing weather query fields.
 * @returns Normalized weather tool input.
 */
function parseWeatherToolInput(input: string): WeatherToolInput {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    throw new Error('City cannot be empty.');
  }

  if (!trimmedInput.startsWith('{')) {
    return { city: trimmedInput, date: getToday() };
  }

  const parsedInput = JSON.parse(trimmedInput) as unknown;

  if (!isRecord(parsedInput)) {
    throw new Error('JSON input must be an object.');
  }

  const city = getStringValue(parsedInput, 'city').trim();
  const locationId = getStringValue(parsedInput, 'locationId').trim();

  if (!city && !locationId) {
    throw new Error(
      'JSON input must include a non-empty "city" or "locationId" string.',
    );
  }

  const language =
    getStringValue(parsedInput, 'lang').trim() ||
    getStringValue(parsedInput, 'language').trim();
  const date = getStringValue(parsedInput, 'date').trim() || getToday();
  const days = getStringValue(parsedInput, 'days').trim();
  const unit = getStringValue(parsedInput, 'unit').trim();

  return {
    city: city || locationId,
    date,
    dateText: getStringValue(parsedInput, 'dateText').trim() || undefined,
    days: isForecastDays(days) ? days : undefined,
    lang: normalizeLanguage(language),
    locationId,
    unit: unit === 'i' ? 'i' : 'm',
  };
}

/**
 * Checks whether a value is a supported QWeather forecast days option.
 *
 * @param value Value to inspect.
 * @returns True when the value is a QWeather forecast days option.
 */
function isForecastDays(value: string): value is QWeatherForecastDays {
  return ['3d', '7d', '10d', '15d', '30d'].includes(value);
}

/**
 * Checks whether a location value can be sent directly to QWeather weather APIs.
 *
 * @param location Location string to inspect.
 * @returns True for LocationID or longitude,latitude coordinates.
 */
function isDirectWeatherLocation(location: string): boolean {
  return (
    /^\d{6,}$/.test(location) || /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location)
  );
}

/**
 * Gets the QWeather API bearer token from environment variables.
 *
 * @returns QWeather JWT token.
 */
function getWeatherApiToken(): string {
  const token = process.env.WEATHER_API_TOKEN?.trim();

  if (!token) {
    throw new Error('QWeather token is required. Set WEATHER_API_TOKEN.');
  }

  return token;
}

/**
 * Checks whether a token looks like a JWT.
 *
 * @param token Weather API token.
 * @returns True when the token has JWT-like segments.
 */
function isJwtToken(token: string): boolean {
  return token.split('.').length === 3;
}

/**
 * Applies QWeather authentication to the request.
 *
 * @param url Request URL.
 * @returns Request headers for JWT authentication, or an empty object for key authentication.
 */
function applyWeatherApiAuth(url: URL): Record<string, string> {
  const token = getWeatherApiToken();

  if (isJwtToken(token)) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  url.searchParams.set('key', token);
  return {};
}

/**
 * Normalizes API host to an absolute URL without a trailing slash.
 *
 * @param host Raw host from configuration.
 * @returns Normalized host URL.
 */
function normalizeApiHost(host: string): string {
  return host.replace(/\/+$/, '');
}

/**
 * Gets the QWeather weather API host from environment variables.
 *
 * @returns QWeather weather API host.
 */
function getWeatherApiHost(): string {
  const apiHost = process.env.WEATHER_API_HOST?.trim();

  if (!apiHost) {
    throw new Error('QWeather API host is required. Set WEATHER_API_HOST.');
  }

  return normalizeApiHost(apiHost);
}

/**
 * Resolves a city name to a QWeather LocationID when needed.
 *
 * @param city City name, LocationID, or coordinates.
 * @param lang QWeather language code.
 * @returns Resolved weather location and optional city metadata.
 */
async function resolveWeatherLocation(
  city: string,
  lang?: string,
  locationId?: string,
): Promise<{ location: string; cityLocation?: QWeatherCityLocation }> {
  if (locationId) {
    return { location: locationId };
  }

  if (isDirectWeatherLocation(city)) {
    return { location: city };
  }

  const lookupResult = await lookupQWeatherCityId({
    lang,
    location: city,
    number: 1,
  });
  const cityLocation = lookupResult.locations[0];

  if (!cityLocation?.id) {
    throw new Error(`Unable to resolve QWeather LocationID for city: ${city}`);
  }

  return { location: cityLocation.id, cityLocation };
}

/**
 * Reads refer metadata from a QWeather response.
 *
 * @param data Raw QWeather response.
 * @returns Refer metadata when present.
 */
function getRefer(data: Record<string, unknown>): QWeatherRefer | undefined {
  if (!isRecord(data.refer)) {
    return undefined;
  }

  return {
    license: getStringArrayValue(data.refer, 'license'),
    sources: getStringArrayValue(data.refer, 'sources'),
  };
}

/**
 * Calculates an average temperature string from min and max values.
 *
 * @param minTemperature Minimum temperature string.
 * @param maxTemperature Maximum temperature string.
 * @returns Rounded average temperature string.
 */
function getAverageTemperature(
  minTemperature: string,
  maxTemperature: string,
): string {
  const min = Number(minTemperature);
  const max = Number(maxTemperature);

  if (Number.isNaN(min) || Number.isNaN(max)) {
    return '';
  }

  return String(Math.round((min + max) / 2));
}

/**
 * Normalizes QWeather realtime response data into the app weather result shape.
 *
 * @param data Raw QWeather realtime JSON response.
 * @param query Weather query input.
 * @param cityLocation Optional resolved city metadata.
 * @returns Normalized realtime weather result.
 */
function normalizeQWeatherNowData(
  data: unknown,
  query: WeatherToolInput,
  cityLocation?: QWeatherCityLocation,
): WeatherResult {
  if (!isRecord(data)) {
    throw new Error('QWeather returned an invalid realtime response.');
  }

  const code = getStringValue(data, 'code');

  if (code !== '200') {
    throw new Error(
      `QWeather realtime weather failed with code: ${code || 'unknown'}`,
    );
  }

  const now = isRecord(data.now) ? data.now : {};

  return {
    city: query.city,
    resolvedCity: cityLocation?.name || query.city,
    country: cityLocation?.country,
    fxLink: getStringValue(data, 'fxLink'),
    region: cityLocation?.adm1,
    locationId: cityLocation?.id,
    localTime: getStringValue(data, 'updateTime'),
    current: {
      description: getStringValue(now, 'text'),
      feelsLike: {
        celsius: getStringValue(now, 'feelsLike'),
      },
      humidity: getStringValue(now, 'humidity'),
      observationTime: getStringValue(now, 'obsTime'),
      precipitationMm: getStringValue(now, 'precip'),
      pressure: getStringValue(now, 'pressure'),
      temperature: {
        celsius: getStringValue(now, 'temp'),
      },
      visibility: getStringValue(now, 'vis'),
      windDirection: getStringValue(now, 'windDir'),
      windSpeedKmph: getStringValue(now, 'windSpeed'),
    },
    forecast: [],
    queryDate: query.date || getToday(),
    queryType: 'now',
    refer: getRefer(data),
    source: 'QWeather',
    updateTime: getStringValue(data, 'updateTime'),
  };
}

/**
 * Normalizes QWeather daily response data into the app weather result shape.
 *
 * @param data Raw QWeather daily JSON response.
 * @param query Weather query input.
 * @param cityLocation Optional resolved city metadata.
 * @returns Normalized daily weather result.
 */
function normalizeQWeatherDailyData(
  data: unknown,
  query: WeatherToolInput,
  cityLocation?: QWeatherCityLocation,
): WeatherResult {
  if (!isRecord(data)) {
    throw new Error('QWeather returned an invalid daily response.');
  }

  const code = getStringValue(data, 'code');

  if (code !== '200') {
    throw new Error(
      `QWeather daily weather failed with code: ${code || 'unknown'}`,
    );
  }

  const dailyRecords = Array.isArray(data.daily)
    ? data.daily.filter(isRecord)
    : [];
  const targetDaily =
    dailyRecords.find((day) => getStringValue(day, 'fxDate') === query.date) ||
    dailyRecords[0] ||
    {};
  const targetMinTemperature = getStringValue(targetDaily, 'tempMin');
  const targetMaxTemperature = getStringValue(targetDaily, 'tempMax');

  return {
    city: query.city,
    resolvedCity: cityLocation?.name || query.city,
    country: cityLocation?.country,
    fxLink: getStringValue(data, 'fxLink'),
    region: cityLocation?.adm1,
    locationId: cityLocation?.id,
    localTime: getStringValue(data, 'updateTime'),
    current: {
      description: getStringValue(targetDaily, 'textDay'),
      feelsLike: {
        celsius: getAverageTemperature(
          targetMinTemperature,
          targetMaxTemperature,
        ),
      },
      humidity: getStringValue(targetDaily, 'humidity'),
      precipitationMm: getStringValue(targetDaily, 'precip'),
      pressure: getStringValue(targetDaily, 'pressure'),
      temperature: {
        celsius: getAverageTemperature(
          targetMinTemperature,
          targetMaxTemperature,
        ),
      },
      uvIndex: getStringValue(targetDaily, 'uvIndex'),
      visibility: getStringValue(targetDaily, 'vis'),
      windDirection: getStringValue(targetDaily, 'windDirDay'),
      windSpeedKmph: getStringValue(targetDaily, 'windSpeedDay'),
    },
    forecast: dailyRecords.map((day) => {
      const minTemperature = getStringValue(day, 'tempMin');
      const maxTemperature = getStringValue(day, 'tempMax');

      return {
        avgTemperature: {
          celsius: getAverageTemperature(minTemperature, maxTemperature),
        },
        date: getStringValue(day, 'fxDate'),
        dateText:
          getStringValue(day, 'fxDate') === query.date
            ? query.dateText
            : undefined,
        dayDescription: getStringValue(day, 'textDay'),
        maxTemperature: {
          celsius: maxTemperature,
        },
        minTemperature: {
          celsius: minTemperature,
        },
        nightDescription: getStringValue(day, 'textNight'),
        precipitationMm: getStringValue(day, 'precip'),
        pressure: getStringValue(day, 'pressure'),
        uvIndex: getStringValue(day, 'uvIndex'),
        visibility: getStringValue(day, 'vis'),
        windDirection: getStringValue(day, 'windDirDay'),
        windScale: getStringValue(day, 'windScaleDay'),
        windSpeedKmph: getStringValue(day, 'windSpeedDay'),
      };
    }),
    queryDate: query.date || getToday(),
    queryType: 'daily',
    refer: getRefer(data),
    source: 'QWeather',
    updateTime: getStringValue(data, 'updateTime'),
  };
}

/**
 * Queries weather details from QWeather.
 *
 * @param city City name, LocationID, or coordinates to query.
 * @param language QWeather language code.
 * @param date Target date in YYYY-MM-DD format.
 * @returns Current weather and forecast details.
 */
export async function queryWeather(
  city: string,
  language = 'zh',
  date = getToday(),
): Promise<WeatherResult> {
  const trimmedCity = city.trim();

  if (!trimmedCity) {
    throw new Error('City cannot be empty.');
  }

  const query: WeatherToolInput = {
    city: trimmedCity,
    date,
    lang: normalizeLanguage(language),
    unit: 'm',
  };

  return queryQWeather(query);
}

/**
 * Queries QWeather weather APIs with routing by target date.
 *
 * @param query Weather tool query.
 * @returns Normalized weather result.
 */
async function queryQWeather(query: WeatherToolInput): Promise<WeatherResult> {
  const targetDate = query.date || getToday();
  const { location, cityLocation } = await resolveWeatherLocation(
    query.city,
    query.lang,
    query.locationId,
  );
  const isToday = targetDate === getToday();
  const path = isToday
    ? '/v7/weather/now'
    : `/v7/weather/${query.days || getForecastDays(targetDate)}`;
  const url = new URL(`${getWeatherApiHost()}${path}`);
  url.searchParams.set('location', location);

  if (query.lang) {
    url.searchParams.set('lang', query.lang);
  }

  if (query.unit) {
    url.searchParams.set('unit', query.unit);
  }

  const response = await fetch(url, {
    headers: applyWeatherApiAuth(url),
  });

  if (!response.ok) {
    throw new Error(`QWeather weather request failed: ${response.status}`);
  }

  const data = (await response.json()) as unknown;

  return isToday
    ? normalizeQWeatherNowData(
        data,
        { ...query, date: targetDate },
        cityLocation,
      )
    : normalizeQWeatherDailyData(
        data,
        { ...query, date: targetDate },
        cityLocation,
      );
}

/**
 * LangChain tool for querying city weather from QWeather.
 */
export const weatherTool = new DynamicTool({
  name: 'weather_query',
  description:
    'Query QWeather weather. Prefer JSON after qweather_city_lookup like {"city":"北京","locationId":"101010100","date":"2026-05-07","dateText":"明天","language":"zh","unit":"m"}. If date is today, calls realtime weather; otherwise calls daily forecast. Returns normalized JSON weather data.',
  func: async (input: string): Promise<string> => {
    const query = parseWeatherToolInput(input);
    return JSON.stringify(await queryQWeather(query));
  },
});
