import { DynamicTool } from '@langchain/core/tools';

const FIXED_YEAR = 2023 as const;
const RUIDUOBAO_HOST = 'https://map.ruiduobao.com';

interface BoundaryIndexResponse {
  filepath?: string;
  message?: string;
  status?: string;
}

/**
 * 边界下载输入参数。
 */
export interface BoundaryFetchInput {
  /** 城市行政区划编码。 */
  cityCode: string;
}

/**
 * 边界下载结果。
 */
export interface BoundaryFetchResult {
  /** 边界原始数据。 */
  boundaryData: Record<string, unknown>;
  /** 城市编码。 */
  cityCode: string;
  /** 数据来源。 */
  source: 'ruiduobao';
  /** 固定年份。 */
  year: 2023;
}

/**
 * 根据城市编码从瑞多宝下载边界数据。
 *
 * @param input 下载输入参数。
 * @returns 边界数据结果。
 */
export async function fetchBoundaryDataByCityCode(
  input: BoundaryFetchInput,
): Promise<BoundaryFetchResult> {
  const cityCode = input.cityCode.trim();

  if (!/^\d{6,12}$/.test(cityCode)) {
    throw new Error('cityCode 格式无效，应为 6-12 位数字。');
  }

  const indexUrl = `${RUIDUOBAO_HOST}/getgsondb?code=${cityCode}&year=${FIXED_YEAR}`;
  const response = await fetch(indexUrl);

  if (!response.ok) {
    throw new Error(`边界接口请求失败：${response.status}`);
  }

  const indexData = (await response.json()) as BoundaryIndexResponse;
  const filepath = indexData.filepath?.trim();

  if (!filepath) {
    throw new Error('边界接口返回缺少 filepath，无法下载几何数据。');
  }

  const geometryUrl = filepath.startsWith('http')
    ? filepath
    : `${RUIDUOBAO_HOST}${filepath.startsWith('/') ? '' : '/'}${filepath}`;
  const geometryResponse = await fetch(geometryUrl);

  if (!geometryResponse.ok) {
    throw new Error(`边界几何数据请求失败：${geometryResponse.status}`);
  }

  const boundaryData = (await geometryResponse.json()) as Record<
    string,
    unknown
  >;

  return {
    boundaryData,
    cityCode,
    source: 'ruiduobao',
    year: FIXED_YEAR,
  };
}

/**
 * LangChain Tool：根据城市编码下载边界数据。
 */
export const boundaryFetchTool = new DynamicTool({
  name: 'boundary_fetch',
  description:
    'Fetch boundary data by city code from RuiDuoBao. Input JSON: {"cityCode":"321084"}. Year is fixed to 2023.',
  func: async (input: string): Promise<string> => {
    const parsed = JSON.parse(input) as BoundaryFetchInput;
    return JSON.stringify(await fetchBoundaryDataByCityCode(parsed));
  },
});
