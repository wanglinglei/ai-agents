import { DynamicTool } from '@langchain/core/tools';
import { getTavilyApiKey } from '../../../common/config/runtime-env.config';

/**
 * 城市编码搜索请求参数。
 */
export interface CityCodeSearchInput {
  /** 城市名称。 */
  cityName: string;
}

/**
 * 城市编码搜索结果。
 */
export interface CityCodeSearchResult {
  /** 城市名称。 */
  cityName: string;
  /** 行政区划编码。 */
  cityCode: string;
  /** 搜索来源。 */
  source: 'tavily';
}

const POSTAL_CODE_KEYWORDS = /(邮编|邮政编码|postcode|zip\s*code)/i;
const ADMIN_CODE_KEYWORDS =
  /(行政区划(?:代码|编码)?|区划代码|adcode|统计用区划代码)/i;

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
 * 规范化城市名称，移除常见语气尾词。
 *
 * @param cityName 原始城市名称。
 * @returns 规范化后的城市名称。
 */
function normalizeCityName(cityName: string): string {
  return cityName.trim().replace(/[的地得]+$/g, '');
}

/**
 * 提取文本中“行政区划代码”上下文的候选编码。
 *
 * @param text 搜索文本。
 * @returns 去重后的候选编码列表。
 */
function extractAdminContextCodes(text: string): string[] {
  const results = new Set<string>();
  const prefixedPattern =
    /(?:行政区划(?:代码|编码)?|区划代码|adcode|统计用区划代码)\D{0,10}(\d{6,12})/gi;
  const suffixedPattern =
    /(\d{6,12})\D{0,10}(?:行政区划(?:代码|编码)?|区划代码|adcode|统计用区划代码)/gi;

  for (const match of text.matchAll(prefixedPattern)) {
    if (match[1] && isValidCityCode(match[1])) {
      results.add(match[1]);
    }
  }
  for (const match of text.matchAll(suffixedPattern)) {
    if (match[1] && isValidCityCode(match[1])) {
      results.add(match[1]);
    }
  }

  return [...results];
}

/**
 * 判断某个编码周围是否是“邮编”语境。
 *
 * @param text 原始文本。
 * @param index 编码在文本中的起始下标。
 * @param codeLength 编码长度。
 * @returns 是否为邮编语境。
 */
function isPostalCodeContext(
  text: string,
  index: number,
  codeLength: number,
): boolean {
  const start = Math.max(0, index - 14);
  const end = Math.min(text.length, index + codeLength + 14);
  const context = text.slice(start, end);
  return (
    POSTAL_CODE_KEYWORDS.test(context) && !ADMIN_CODE_KEYWORDS.test(context)
  );
}

/**
 * 提取文本中所有候选数字编码（过滤明显邮编语境）。
 *
 * @param text 搜索文本。
 * @returns 去重后的候选编码列表。
 */
function extractCodesFromText(text: string): string[] {
  const matchedCodes = [...text.matchAll(/\b(\d{6,12})\b/g)];
  const filteredCodes = matchedCodes
    .filter((item) => {
      const code = item[1];
      const index = item.index ?? 0;
      return (
        isValidCityCode(code) && !isPostalCodeContext(text, index, code.length)
      );
    })
    .map((item) => item[1]);
  return [...new Set(filteredCodes)];
}

/**
 * 从候选编码中挑选最可能的城市编码。
 *
 * @param codes 候选编码。
 * @returns 最优编码，不存在时返回 undefined。
 */
function pickBestCityCode(codes: string[]): string | undefined {
  const sixDigits = codes.find((code) => code.length === 6);
  return sixDigits ?? codes[0];
}

/**
 * 通过 Tavily 网络搜索查询城市行政区划编码。
 *
 * @param input 城市名称输入。
 * @returns 城市编码结果。
 */
export async function searchCityCodeByTavily(
  input: CityCodeSearchInput,
): Promise<CityCodeSearchResult> {
  const cityName = normalizeCityName(input.cityName);

  if (!cityName) {
    throw new Error('cityName 不能为空。');
  }

  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    throw new Error('缺少 TAVILY_API_KEY，无法执行网络搜索。');
  }

  const response = await fetch('https://api.tavily.com/search', {
    body: JSON.stringify({
      api_key: apiKey,
      include_answer: true,
      max_results: 8,
      query: `${cityName} 行政区划代码`,
      search_depth: 'advanced',
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Tavily 搜索请求失败：${response.status}`);
  }

  const payload = (await response.json()) as {
    answer?: string;
    results?: Array<{ content?: string; title?: string }>;
  };

  const chunks: string[] = [];
  if (typeof payload.answer === 'string') {
    chunks.push(payload.answer);
  }
  for (const item of payload.results ?? []) {
    if (item.title) {
      chunks.push(item.title);
    }
    if (item.content) {
      chunks.push(item.content);
    }
  }

  const searchText = chunks.join('\n');
  const adminContextCodes = extractAdminContextCodes(searchText);
  const fallbackCodes = extractCodesFromText(searchText);
  const codes =
    adminContextCodes.length > 0
      ? [...new Set([...adminContextCodes, ...fallbackCodes])]
      : fallbackCodes;
  const cityCode = pickBestCityCode(codes);

  if (!cityCode) {
    throw new Error(`未从网络搜索结果中识别到 ${cityName} 的行政区划编码。`);
  }

  return {
    cityCode,
    cityName,
    source: 'tavily',
  };
}

/**
 * LangChain Tool：城市编码网络搜索。
 */
export const cityCodeSearchTool = new DynamicTool({
  name: 'city_code_search',
  description:
    'Search city administrative code via Tavily web search. Input JSON: {"cityName":"高邮市"}.',
  func: async (input: string): Promise<string> => {
    const parsed = JSON.parse(input) as CityCodeSearchInput;
    return JSON.stringify(await searchCityCodeByTavily(parsed));
  },
});
