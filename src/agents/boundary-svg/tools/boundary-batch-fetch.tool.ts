import { DynamicTool } from '@langchain/core/tools';
import AdmZip from 'adm-zip';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';

const FIXED_YEAR = 2023 as const;
const RUIDUOBAO_HOST = 'https://map.ruiduobao.com';
const GEOJSON_MIME_TYPE = 'application/geo+json; charset=utf-8';

/**
 * 批量边界下载输入参数。
 */
export interface BoundaryBatchFetchInput {
  /** 城市行政区划编码。 */
  cityCode: string;
}

/**
 * 行政级别。
 */
export type BoundaryAdminLevel = 'city' | 'county';

/**
 * 批量边界下载结果。
 */
export interface BoundaryBatchFetchResult {
  /** 统一的 GeoJSON 边界数据。 */
  boundaryData: Record<string, unknown>;
  /** 城市编码（6 位）。 */
  cityCode: string;
  /** 数据来源。 */
  source: 'ruiduobao_batch';
  /** 固定年份。 */
  year: 2023;
  /** 输入编码对应的行政级别。 */
  adminLevel: BoundaryAdminLevel;
  /** 命中的目标目录（相对解压根目录）。 */
  selectedDirectory: string;
  /** 命中的 geojson 文件数量。 */
  selectedFileCount: number;
}

interface BoundaryDownloadResult {
  fileBuffer: Buffer;
  fileName: string;
}

interface AdmZipInstance {
  extractAllTo: (targetPath: string, overwrite?: boolean) => void;
}

interface AdmZipConstructor {
  new (input?: Buffer | string): AdmZipInstance;
}

const AdmZipClass = AdmZip as unknown as AdmZipConstructor;

/**
 * 基于 6 位行政区划编码判断行政级别。
 *
 * @param cityCode 城市编码（6 位）。
 * @returns 行政级别。
 */
function resolveAdminLevel(cityCode: string): BoundaryAdminLevel {
  return cityCode.endsWith('00') ? 'city' : 'county';
}

/**
 * 规范化并校验城市编码。
 *
 * @param rawCityCode 原始城市编码。
 * @returns 6 位城市编码。
 */
function normalizeCityCode(rawCityCode: string): string {
  const cityCode = rawCityCode.trim();
  if (!/^\d{6,12}$/.test(cityCode)) {
    throw new Error('cityCode 格式无效，应为 6-12 位数字。');
  }
  return cityCode.slice(0, 6);
}

/**
 * 下载含下级边界压缩包。
 *
 * @param cityCode 6 位城市编码。
 * @returns 下载结果。
 */
async function downloadBoundaryBatchZip(
  cityCode: string,
  adminLevel: BoundaryAdminLevel,
): Promise<BoundaryDownloadResult> {
  const requestPath =
    adminLevel === 'city'
      ? `/downloadCityBatch/city/${cityCode}`
      : `/downloadCountyBatch/county/${cityCode}`;
  const requestUrl = `${RUIDUOBAO_HOST}${requestPath}?format=shp&year=${FIXED_YEAR}`;
  const response = await fetch(requestUrl, {
    headers: {
      Referer: `${RUIDUOBAO_HOST}/`,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`批量边界下载失败：${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);
  if (!fileBuffer.length) {
    throw new Error('批量边界下载返回空文件。');
  }

  return {
    fileBuffer,
    fileName: `${cityCode}_含下级.zip`,
  };
}

/**
 * 递归收集目录列表。
 *
 * @param rootDir 根目录。
 * @returns 所有目录绝对路径。
 */
async function collectDirectories(rootDir: string): Promise<string[]> {
  const result: string[] = [rootDir];
  const stack: string[] = [rootDir];

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const fullPath = join(currentDir, entry.name);
      result.push(fullPath);
      stack.push(fullPath);
    }
  }

  return result;
}

/**
 * 按行政级别选择目标目录。
 *
 * @param rootDir 解压根目录。
 * @param adminLevel 行政级别。
 * @returns 命中目录。
 */
async function selectTargetDirectory(
  rootDir: string,
  adminLevel: BoundaryAdminLevel,
): Promise<string> {
  const directoryList = await collectDirectories(rootDir);
  const normalizedWithPath = directoryList.map((dirPath) => ({
    dirPath,
    normalized: relative(rootDir, dirPath).replaceAll('\\', '/').toLowerCase(),
  }));

  const targetKeywords =
    adminLevel === 'city'
      ? ['县级', '县区', '区县', 'county']
      : ['乡镇', '镇街', '街道', 'town'];

  const matched = normalizedWithPath.find(({ normalized }) =>
    targetKeywords.some((keyword) => normalized.includes(keyword)),
  );

  if (!matched) {
    throw new Error(
      `未找到目标层级目录：${adminLevel === 'city' ? '县级' : '乡镇'}。`,
    );
  }

  return matched.dirPath;
}

/**
 * 递归收集指定扩展名文件。
 *
 * @param rootDir 根目录。
 * @param extension 扩展名（带点号）。
 * @returns 命中文件绝对路径列表。
 */
async function collectFilesByExtension(
  rootDir: string,
  extension: string,
): Promise<string[]> {
  const matchedFiles: string[] = [];
  const stack: string[] = [rootDir];
  const normalizedExt = extension.toLowerCase();

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (extname(entry.name).toLowerCase() === normalizedExt) {
        matchedFiles.push(fullPath);
      }
    }
  }

  return matchedFiles;
}

/**
 * 从 geojson 文件中读取边界数据。
 *
 * @param geojsonPath geojson 文件路径。
 * @returns GeoJSON 对象。
 */
async function readGeoJsonFile(
  geojsonPath: string,
): Promise<Record<string, unknown>> {
  const rawContent = await readFile(geojsonPath, 'utf-8');
  const parsed = JSON.parse(rawContent) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { type?: unknown }).type !== 'string'
  ) {
    throw new Error('geojson 文件内容无效，缺少合法的对象结构。');
  }
  return parsed as Record<string, unknown>;
}

/**
 * 通过批量下载、解压和读取流程获取下级边界 GeoJSON。
 *
 * @param input 下载输入参数。
 * @returns 批量边界结果。
 */
export async function fetchBoundaryDataByBatchZip(
  input: BoundaryBatchFetchInput,
): Promise<BoundaryBatchFetchResult> {
  const cityCode = normalizeCityCode(input.cityCode);
  const adminLevel = resolveAdminLevel(cityCode);

  const tempRoot = await mkdtemp(join(tmpdir(), 'boundary-batch-'));
  try {
    const zipDownload = await downloadBoundaryBatchZip(cityCode, adminLevel);
    const zipPath = join(tempRoot, zipDownload.fileName);
    await writeFile(zipPath, zipDownload.fileBuffer);

    const extractDir = join(tempRoot, 'extracted');
    const zip = new AdmZipClass(zipPath);
    zip.extractAllTo(extractDir, true);

    const targetDirectory = await selectTargetDirectory(extractDir, adminLevel);
    const geojsonFiles = await collectFilesByExtension(
      targetDirectory,
      '.geojson',
    );
    if (!geojsonFiles.length) {
      throw new Error('目标目录未找到 .geojson 文件。');
    }

    const selectedGeoJsonPath = geojsonFiles.sort()[0];
    const boundaryData = await readGeoJsonFile(selectedGeoJsonPath);

    return {
      boundaryData: JSON.parse(JSON.stringify(boundaryData)) as Record<
        string,
        unknown
      >,
      cityCode,
      source: 'ruiduobao_batch',
      year: FIXED_YEAR,
      adminLevel,
      selectedDirectory: relative(extractDir, targetDirectory) || '.',
      selectedFileCount: geojsonFiles.length,
    };
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

/**
 * LangChain Tool：基于批量压缩包获取下级边界数据。
 */
export const boundaryBatchFetchTool = new DynamicTool({
  name: 'boundary_batch_fetch',
  description:
    'Fetch boundary data from RuiDuoBao batch zip (city uses downloadCityBatch, county uses downloadCountyBatch; format=shp), unzip and read target sub-level geojson directly. Input JSON: {"cityCode":"321000"}.',
  func: async (input: string): Promise<string> => {
    const parsed = JSON.parse(input) as BoundaryBatchFetchInput;
    return JSON.stringify(await fetchBoundaryDataByBatchZip(parsed));
  },
});

/**
 * 构建非 SVG 场景给前端下载的 GeoJSON 文件载荷。
 *
 * @param cityCode 城市编码。
 * @param boundaryData GeoJSON 数据。
 * @returns 文件下载载荷。
 */
export function buildGeoJsonDownloadPayload(
  cityCode: string,
  boundaryData: Record<string, unknown>,
): {
  fileName: string;
  mimeType: string;
  fileContent: string;
} {
  return {
    fileName: `${cityCode}_${FIXED_YEAR}.geojson`,
    mimeType: GEOJSON_MIME_TYPE,
    fileContent: JSON.stringify(boundaryData, null, 2),
  };
}
