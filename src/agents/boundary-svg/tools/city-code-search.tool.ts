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
 * 提取文本中所有候选数字编码。
 *
 * @param text 搜索文本。
 * @returns 去重后的候选编码列表。
 */
function extractCodesFromText(text: string): string[] {
  const matchedCodes = text.match(/\b\d{6,12}\b/g) ?? [];
  return [...new Set(matchedCodes.filter(isValidCityCode))];
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
  const cityName = input.cityName.trim();

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

  const codes = extractCodesFromText(chunks.join('\n'));
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
