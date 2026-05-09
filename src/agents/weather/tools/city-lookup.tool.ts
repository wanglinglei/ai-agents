/*
 * @Author: wanglinglei
 * @Date: 2026-05-06 15:50:00
 * @Description: 和风天气城市 ID 查询工具
 * @FilePath: /agents/src/agents/weather/tools/city-lookup.tool.ts
 */
import { DynamicTool } from '@langchain/core/tools';
import {
  getWeatherApiHost as getWeatherApiHostFromConfig,
  getWeatherApiToken as getWeatherApiTokenFromConfig,
} from '../../../common/config/runtime-env.config';

export interface CityLookupToolInput {
  adm?: string;
  lang?: string;
  location: string;
  number?: number;
  range?: string;
}

export interface QWeatherCityLocation {
  adm1: string;
  adm2: string;
  country: string;
  fxLink: string;
  id: string;
  isDst: string;
  lat: string;
  lon: string;
  name: string;
  rank: string;
  type: string;
  tz: string;
  utcOffset: string;
}

export interface QWeatherRefer {
  license?: string[];
  sources?: string[];
}

export interface CityLookupResult {
  code: string;
  locations: QWeatherCityLocation[];
  refer?: QWeatherRefer;
  source: string;
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
 * Parses LangChain tool input into a QWeather city lookup query.
 *
 * @param input Raw location text or JSON string containing lookup fields.
 * @returns Normalized city lookup input.
 */
function parseCityLookupToolInput(input: string): CityLookupToolInput {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    throw new Error('Location cannot be empty.');
  }

  if (!trimmedInput.startsWith('{')) {
    return { location: trimmedInput };
  }

  const parsedInput = JSON.parse(trimmedInput) as unknown;

  if (!isRecord(parsedInput)) {
    throw new Error('JSON input must be an object.');
  }

  const location = getStringValue(parsedInput, 'location').trim();

  if (!location) {
    throw new Error('JSON input must include a non-empty "location" string.');
  }

  const numberValue = parsedInput.number;
  const number =
    typeof numberValue === 'number' && Number.isInteger(numberValue)
      ? numberValue
      : undefined;

  return {
    location,
    adm: getStringValue(parsedInput, 'adm').trim() || undefined,
    lang: getStringValue(parsedInput, 'lang').trim() || undefined,
    number,
    range: getStringValue(parsedInput, 'range').trim() || undefined,
  };
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
 * Gets the QWeather API bearer token from environment variables.
 *
 * @returns QWeather JWT token.
 */
function getWeatherApiToken(): string {
  const token = getWeatherApiTokenFromConfig();

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
 * Gets the QWeather API host from environment variables.
 *
 * @returns QWeather API host.
 */
function getWeatherApiHost(): string {
  const apiHost = getWeatherApiHostFromConfig();

  if (!apiHost) {
    throw new Error('QWeather API host is required. Set WEATHER_API_HOST.');
  }

  return normalizeApiHost(apiHost);
}

/**
 * Converts a raw QWeather location record into a typed city location.
 *
 * @param location Raw location record from QWeather.
 * @returns Normalized city location.
 */
function normalizeLocation(
  location: Record<string, unknown>,
): QWeatherCityLocation {
  return {
    adm1: getStringValue(location, 'adm1'),
    adm2: getStringValue(location, 'adm2'),
    country: getStringValue(location, 'country'),
    fxLink: getStringValue(location, 'fxLink'),
    id: getStringValue(location, 'id'),
    isDst: getStringValue(location, 'isDst'),
    lat: getStringValue(location, 'lat'),
    lon: getStringValue(location, 'lon'),
    name: getStringValue(location, 'name'),
    rank: getStringValue(location, 'rank'),
    type: getStringValue(location, 'type'),
    tz: getStringValue(location, 'tz'),
    utcOffset: getStringValue(location, 'utcOffset'),
  };
}

/**
 * Normalizes QWeather city lookup response data.
 *
 * @param data Raw QWeather JSON response.
 * @returns Normalized city lookup result.
 */
function normalizeCityLookupData(data: unknown): CityLookupResult {
  if (!isRecord(data)) {
    throw new Error('QWeather returned an invalid response.');
  }

  const code = getStringValue(data, 'code');

  if (code !== '200') {
    throw new Error(
      `QWeather city lookup failed with code: ${code || 'unknown'}`,
    );
  }

  const refer = isRecord(data.refer)
    ? {
        license: getStringArrayValue(data.refer, 'license'),
        sources: getStringArrayValue(data.refer, 'sources'),
      }
    : undefined;

  return {
    code,
    locations: Array.isArray(data.location)
      ? data.location.filter(isRecord).map(normalizeLocation)
      : [],
    refer,
    source: 'QWeather',
  };
}

/**
 * Queries QWeather GeoAPI city lookup for Location IDs.
 *
 * @param input City lookup input.
 * @returns Matching city locations with QWeather Location IDs.
 */
export async function lookupQWeatherCityId(
  input: CityLookupToolInput,
): Promise<CityLookupResult> {
  const location = input.location.trim();

  if (!location) {
    throw new Error('Location cannot be empty.');
  }

  const url = new URL(`${getWeatherApiHost()}/geo/v2/city/lookup`);
  url.searchParams.set('location', location);

  if (input.adm) {
    url.searchParams.set('adm', input.adm);
  }

  if (input.range) {
    url.searchParams.set('range', input.range);
  }

  if (input.number) {
    url.searchParams.set('number', String(input.number));
  }

  if (input.lang) {
    url.searchParams.set('lang', input.lang);
  }

  const response = await fetch(url, {
    headers: applyWeatherApiAuth(url),
  });

  if (!response.ok) {
    throw new Error(`QWeather city lookup request failed: ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  return normalizeCityLookupData(data);
}

/**
 * LangChain tool for querying QWeather city Location IDs.
 */
export const cityLookupTool = new DynamicTool({
  name: 'qweather_city_lookup',
  description:
    'Query QWeather GeoAPI city Location IDs. Input can be a raw city/location name, LocationID, Adcode, coordinates like "116.41,39.92", or JSON like {"location":"北京","adm":"北京","range":"cn","number":5,"lang":"zh"}. Returns matching locations and their QWeather id values.',
  func: async (input: string): Promise<string> =>
    JSON.stringify(await lookupQWeatherCityId(parseCityLookupToolInput(input))),
});
