import { DynamicTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import {
  getOpenAIApiKey,
  getOpenAICompatibleBaseUrl,
  getOpenAIModelName,
} from '../../../common/config/runtime-env.config';
import { createLangChainLocalTraceConfig } from '../../../common/langchain/langchain-local-trace';
import type { BoundarySvgIntent } from '../types/boundary-svg-agent.types';

const FIXED_YEAR = 2023 as const;
const DEFAULT_BOUNDARY_INTENT_PARSE_MODEL = 'qw-plus';
const BOUNDARY_INTENT_PARSE_TEMPERATURE = 0;

interface BoundaryIntentModelResult {
  action?: BoundarySvgIntent['action'];
  cityCode?: string;
  cityName?: string;
  needSvg?: boolean;
}

/**
 * 判断编码是否符合常见行政区划码格式。
 *
 * @param code 候选编码。
 * @returns 是否有效。
 */
function isValidCityCode(code: string): boolean {
  return /^\d{6,12}$/.test(code);
}

/**
 * 从用户原始输入中提取显式声明的城市编码。
 *
 * @param message 用户输入文本。
 * @returns 提取到的城市编码，不存在时返回 undefined。
 */
function extractExplicitCityCodeFromUserInput(
  message: string,
): string | undefined {
  const normalized = message.trim();
  if (!normalized) {
    return undefined;
  }

  const prefixedPattern =
    /(?:城市(?:编码|code)?|编码|code|adcode)\s*[:：=]?\s*(\d{6,12})/i;
  const prefixedMatch = normalized.match(prefixedPattern);
  if (prefixedMatch?.[1] && isValidCityCode(prefixedMatch[1])) {
    return prefixedMatch[1];
  }

  const suffixedPattern = /(\d{6,12})\s*(?:编码|code|adcode)/i;
  const suffixedMatch = normalized.match(suffixedPattern);
  if (suffixedMatch?.[1] && isValidCityCode(suffixedMatch[1])) {
    return suffixedMatch[1];
  }

  const standaloneCodeMatch = normalized.match(/\b(\d{6,12})\b/);
  if (standaloneCodeMatch?.[1] && isValidCityCode(standaloneCodeMatch[1])) {
    return standaloneCodeMatch[1];
  }

  return undefined;
}

/**
 * 从用户输入中提取城市名称。
 *
 * @param message 用户输入文本。
 * @returns 城市名称，不存在时返回 undefined。
 */
function extractCityName(message: string): string | undefined {
  const cityPattern =
    /([\u4e00-\u9fa5]{2,}(?:市|区|县|州|盟|自治州|自治县|特别行政区))/g;
  const invalidCityCandidatePattern =
    /(请|使用|查询|获取|下载|生成|查看|帮我|给我|城市)/;
  const explicitMatches = [...message.matchAll(cityPattern)];
  for (const matched of explicitMatches) {
    const candidate = matched[1]?.trim();
    if (!candidate) {
      continue;
    }
    if (!invalidCityCandidatePattern.test(candidate)) {
      return candidate;
    }
  }

  const fuzzyPattern =
    /(?:给我|查询|获取|下载|生成|查看)\s*([\u4e00-\u9fa5]{2,10})(?:的)?边界/;
  const fuzzyMatch = message.match(fuzzyPattern);
  const fuzzyCandidate = fuzzyMatch?.[1]?.trim();
  if (!fuzzyCandidate) {
    return undefined;
  }
  return invalidCityCandidatePattern.test(fuzzyCandidate)
    ? undefined
    : fuzzyCandidate;
}

/**
 * 判断是否是“SVG 样式修改”指令。
 *
 * @param message 用户输入文本。
 * @returns 是否属于样式修改。
 */
function isSvgStyleUpdateIntent(message: string): boolean {
  const hasStyleKeyword = /(填充|描边|边框|线条|颜色)/.test(message);
  const hasUpdateKeyword = /(改为|改成|修改|变为|变成|设置为|设为)/.test(
    message,
  );
  return hasStyleKeyword && hasUpdateKeyword;
}

/**
 * 判断用户是否要求生成 SVG。
 *
 * @param message 用户输入文本。
 * @returns 是否需要生成 SVG。
 */
function detectNeedSvg(message: string): boolean {
  return /(svg|生成图|矢量图|转成svg)/i.test(message);
}

/**
 * 判断值是否为普通对象。
 *
 * @param value 任意值。
 * @returns 是否为对象记录。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 提取模型返回文本。
 *
 * @param result 模型返回值。
 * @returns 文本内容。
 */
function getModelMessage(result: unknown): string {
  if (!isRecord(result)) {
    return '';
  }

  const { content } = result;
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }

      if (!isRecord(item)) {
        return '';
      }

      const text = item.text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * 从任意文本中提取第一个 JSON 对象。
 *
 * @param rawText 原始文本。
 * @returns 解析后的对象，失败时返回 undefined。
 */
function tryParseJsonObject(
  rawText: string,
): Record<string, unknown> | undefined {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const directParsed: unknown = JSON.parse(trimmed);
    return isRecord(directParsed) ? directParsed : undefined;
  } catch {
    const matched = trimmed.match(/\{[\s\S]*\}/);
    if (!matched?.[0]) {
      return undefined;
    }

    try {
      const extractedParsed: unknown = JSON.parse(matched[0]);
      return isRecord(extractedParsed) ? extractedParsed : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * 判断当前规则解析结果是否需要触发模型兜底。
 *
 * @param message 用户输入文本。
 * @param intent 规则解析出的意图。
 * @returns true 表示建议调用模型补充解析。
 */
function shouldFallbackToModel(
  message: string,
  intent: BoundarySvgIntent,
): boolean {
  const hasStyleKeyword = /(填充|描边|边框|线条|颜色)/.test(message);
  const hasColorWord =
    /(#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b|红|蓝|绿|黄|黑|白|灰|橙|紫|color)/i.test(
      message,
    );

  if (
    intent.action === 'generate_boundary' &&
    hasStyleKeyword &&
    (hasColorWord || !intent.cityCode)
  ) {
    return true;
  }

  if (
    intent.action === 'generate_boundary' &&
    !intent.cityCode &&
    !intent.cityName
  ) {
    return true;
  }

  return false;
}

/**
 * 基于大模型解析 boundary 用户意图。
 *
 * @param message 用户输入文本。
 * @returns 解析后的部分字段，失败时返回 undefined。
 */
async function parseBoundaryIntentByModel(
  message: string,
): Promise<BoundaryIntentModelResult | undefined> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return undefined;
  }

  try {
    const model = new ChatOpenAI({
      apiKey,
      configuration: {
        baseURL: getOpenAICompatibleBaseUrl(),
      },
      model: getOpenAIModelName(DEFAULT_BOUNDARY_INTENT_PARSE_MODEL),
      temperature: BOUNDARY_INTENT_PARSE_TEMPERATURE,
    });

    const response = await model.invoke(
      [
        {
          role: 'system',
          content: [
            '你是 boundary-svg 请求意图解析器。',
            '请输出 JSON 对象，字段仅允许 action、cityCode、cityName、needSvg。',
            'action 只能是 generate_boundary 或 update_svg_style。',
            'cityCode 若不存在请返回 null，存在时必须是 6-12 位数字字符串。',
            'cityName 若不存在请返回 null。',
            'needSvg 必须是 boolean。',
            '禁止输出解释、Markdown、额外字段。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: message,
        },
      ],
      createLangChainLocalTraceConfig({
        metadata: {
          agent: 'boundary-svg',
          phase: 'intent-parse',
          tool: 'boundary_intent_parse',
        },
        runName: 'boundary-svg.intent-parse.model.invoke',
        tags: ['boundary-svg', 'tool'],
      }),
    );

    const parsed = tryParseJsonObject(getModelMessage(response));
    if (!parsed) {
      return undefined;
    }

    const action: BoundarySvgIntent['action'] | undefined =
      parsed.action === 'generate_boundary' ||
      parsed.action === 'update_svg_style'
        ? parsed.action
        : undefined;
    const cityCode =
      typeof parsed.cityCode === 'string' && isValidCityCode(parsed.cityCode)
        ? parsed.cityCode
        : undefined;
    const cityName =
      typeof parsed.cityName === 'string' && parsed.cityName.trim()
        ? parsed.cityName.trim()
        : undefined;
    const needSvg =
      typeof parsed.needSvg === 'boolean' ? parsed.needSvg : undefined;

    const result: BoundaryIntentModelResult = {};
    if (action) {
      result.action = action;
    }
    if (cityCode) {
      result.cityCode = cityCode;
    }
    if (cityName) {
      result.cityName = cityName;
    }
    if (typeof needSvg === 'boolean') {
      result.needSvg = needSvg;
    }

    return result;
  } catch {
    return undefined;
  }
}

/**
 * 解析用户输入，输出 boundary-svg 的结构化业务意图。
 *
 * @param input 工具输入文本。
 * @returns 结构化意图。
 */
export async function parseBoundaryIntent(
  input: string,
): Promise<BoundarySvgIntent> {
  const message = input.trim();

  if (!message) {
    throw new Error('输入内容不能为空。');
  }

  const ruleAction = isSvgStyleUpdateIntent(message)
    ? 'update_svg_style'
    : 'generate_boundary';
  const ruleCityCode = extractExplicitCityCodeFromUserInput(message);
  const ruleCityName = extractCityName(message);
  const ruleNeedSvg =
    ruleAction === 'update_svg_style' ? true : detectNeedSvg(message);
  const ruleIntent: BoundarySvgIntent = {
    action: ruleAction,
    ...(ruleCityCode ? { cityCode: ruleCityCode } : {}),
    ...(ruleCityName ? { cityName: ruleCityName } : {}),
    needSvg: ruleNeedSvg,
    year: FIXED_YEAR,
  };

  if (!shouldFallbackToModel(message, ruleIntent)) {
    return ruleIntent;
  }

  const modelIntent = await parseBoundaryIntentByModel(message);
  if (!modelIntent) {
    return ruleIntent;
  }

  const modelAction: BoundarySvgIntent['action'] | undefined =
    modelIntent.action === 'generate_boundary' ||
    modelIntent.action === 'update_svg_style'
      ? modelIntent.action
      : undefined;
  const modelCityCode: string | undefined =
    typeof modelIntent.cityCode === 'string' ? modelIntent.cityCode : undefined;
  const modelCityName: string | undefined =
    typeof modelIntent.cityName === 'string' ? modelIntent.cityName : undefined;
  const resolvedAction: BoundarySvgIntent['action'] =
    modelAction ?? ruleIntent.action;
  const resolvedCityCode: string | undefined =
    ruleIntent.cityCode ?? modelCityCode;
  const resolvedCityName: string | undefined =
    ruleIntent.cityName ?? modelCityName;
  const resolvedNeedSvg: boolean =
    resolvedAction === 'update_svg_style' ? true : ruleIntent.needSvg;

  return {
    action: resolvedAction,
    ...(resolvedCityCode ? { cityCode: resolvedCityCode } : {}),
    ...(resolvedCityName ? { cityName: resolvedCityName } : {}),
    needSvg: resolvedNeedSvg,
    year: FIXED_YEAR,
  };
}

/**
 * LangChain Tool：解析 boundary-svg 用户意图。
 */
export const boundaryIntentParseTool = new DynamicTool({
  name: 'boundary_intent_parse',
  description:
    'Parse boundary intent from user text. Return action(generate_boundary/update_svg_style), optional cityCode/cityName, needSvg, and fixed year 2023.',
  func: async (input: string): Promise<string> =>
    JSON.stringify(await parseBoundaryIntent(input)),
});
