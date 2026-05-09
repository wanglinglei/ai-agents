const DEFAULT_OPENAI_MODEL = 'qw-plus';
const DEFAULT_LANGCHAIN_MODEL = 'gpt-4o-mini';

/**
 * 读取并裁剪环境变量。
 *
 * @param key 环境变量名。
 * @returns 去空白后的值，缺失时返回 undefined。
 */
function readEnv(key: string): string | undefined {
  const rawValue = process.env[key];
  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const normalizedValue = rawValue.trim();
  return normalizedValue || undefined;
}

/**
 * 读取 OpenAI 兼容 API Key。
 *
 * @returns API Key，缺失时返回 undefined。
 */
export function getOpenAIApiKey(): string | undefined {
  return readEnv('OPENAI_API_KEY');
}

/**
 * 判断是否已配置 OpenAI 兼容 API Key。
 *
 * @returns 是否存在可用 API Key。
 */
export function hasOpenAIApiKey(): boolean {
  return Boolean(getOpenAIApiKey());
}

/**
 * 读取 OpenAI 兼容 Base URL。
 *
 * @returns Base URL，缺失时返回 undefined。
 */
export function getOpenAICompatibleBaseUrl(): string | undefined {
  return readEnv('OPENAI_COMPATIBLE_BASE_URL');
}

/**
 * 读取 LangChain 示例调用的 OpenAI Base URL。
 *
 * @returns Base URL，缺失时返回 undefined。
 */
export function getOpenAIBaseUrl(): string | undefined {
  return readEnv('OPENAI_BASE_URL');
}

/**
 * 读取 OpenAI 模型名。
 *
 * @param fallback 未配置时使用的兜底模型名。
 * @returns 模型名。
 */
export function getOpenAIModelName(fallback = DEFAULT_OPENAI_MODEL): string {
  return readEnv('OPENAI_MODEL') ?? fallback;
}

/**
 * 读取 LangChain 示例模型名。
 *
 * @returns 模型名。
 */
export function getLangChainModelName(): string {
  return getOpenAIModelName(DEFAULT_LANGCHAIN_MODEL);
}

/**
 * 读取 Weather API Token。
 *
 * @returns Token，缺失时返回 undefined。
 */
export function getWeatherApiToken(): string | undefined {
  return readEnv('WEATHER_API_TOKEN');
}

/**
 * 判断是否已配置 Weather API Token。
 *
 * @returns 是否存在可用 token。
 */
export function hasWeatherApiToken(): boolean {
  return Boolean(getWeatherApiToken());
}

/**
 * 读取 Weather API Host。
 *
 * @returns Host，缺失时返回 undefined。
 */
export function getWeatherApiHost(): string | undefined {
  return readEnv('WEATHER_API_HOST');
}

/**
 * 读取 LangChain 本地 trace 开关原始值。
 *
 * @returns 开关值，未配置时返回 undefined。
 */
export function getLangChainLocalTraceValue(): string | undefined {
  return readEnv('LANGCHAIN_LOCAL_TRACE');
}

/**
 * 读取 Tinify/TinyPNG API Key。
 *
 * @returns API Key，未配置时返回 undefined。
 */
export function getTinifyApiKey(): string | undefined {
  return readEnv('TINIFY_API_KEY') ?? readEnv('TINYPNG_API_KEY');
}
