import { DynamicTool } from '@langchain/core/tools';
import type { BoundarySvgStyle } from '../types/boundary-svg-agent.types';

const SVG_CANVAS_SIZE = 1024;
const SVG_PADDING = 16;

/**
 * 默认 SVG 样式。
 */
export const DEFAULT_BOUNDARY_SVG_STYLE: BoundarySvgStyle = {
  fillColor: '#dbeafe',
  strokeColor: '#1f2937',
  strokeWidth: 1,
};

/**
 * SVG 生成输入参数。
 */
export interface BoundarySvgBuildInput {
  /** 边界原始数据。 */
  boundaryData: Record<string, unknown>;
  /** 可选样式覆盖。 */
  style?: Partial<BoundarySvgStyle>;
}

/**
 * SVG 生成结果。
 */
export interface BoundarySvgBuildResult {
  /** 生成后的 SVG 文本。 */
  svg: string;
  /** 实际使用样式。 */
  style: BoundarySvgStyle;
}

type Point = [number, number];
type Ring = Point[];

/**
 * 判断是否是对象记录。
 *
 * @param value 任意值。
 * @returns 是否是对象记录。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从任意边界结构中收集所有 Polygon ring。
 *
 * @param boundaryData 边界原始数据。
 * @returns ring 列表。
 */
function collectRings(boundaryData: Record<string, unknown>): Ring[] {
  const rings: Ring[] = [];

  /**
   * 深度遍历 GeoJSON 节点。
   *
   * @param node 当前节点。
   */
  const walk = (node: unknown): void => {
    if (!isRecord(node)) {
      return;
    }

    const nodeType = typeof node.type === 'string' ? node.type : '';

    if (nodeType === 'FeatureCollection' && Array.isArray(node.features)) {
      for (const feature of node.features) {
        walk(feature);
      }
      return;
    }

    if (nodeType === 'Feature') {
      walk(node.geometry);
      return;
    }

    if (nodeType === 'Polygon') {
      const coordinates = node.coordinates;
      if (Array.isArray(coordinates)) {
        for (const ring of coordinates) {
          const normalized = normalizeRing(ring);
          if (normalized.length > 2) {
            rings.push(normalized);
          }
        }
      }
      return;
    }

    if (nodeType === 'MultiPolygon') {
      const coordinates = node.coordinates;
      if (Array.isArray(coordinates)) {
        for (const polygon of coordinates) {
          if (!Array.isArray(polygon)) {
            continue;
          }
          for (const ring of polygon) {
            const normalized = normalizeRing(ring);
            if (normalized.length > 2) {
              rings.push(normalized);
            }
          }
        }
      }
      return;
    }

    if (Array.isArray(node.features)) {
      for (const feature of node.features) {
        walk(feature);
      }
    }

    if (isRecord(node.geometry)) {
      walk(node.geometry);
    }
  };

  walk(boundaryData);
  return rings;
}

/**
 * 归一化 ring 坐标结构。
 *
 * @param input 原始 ring 数据。
 * @returns 坐标点列表。
 */
function normalizeRing(input: unknown): Ring {
  if (!Array.isArray(input)) {
    return [];
  }

  const points: Point[] = [];
  for (const item of input) {
    if (!Array.isArray(item) || item.length < 2) {
      continue;
    }
    const x = Number(item[0]);
    const y = Number(item[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    points.push([x, y]);
  }
  return points;
}

/**
 * 根据 ring 计算边界框。
 *
 * @param rings ring 列表。
 * @returns 边界框信息。
 */
function computeBounds(rings: Ring[]): {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { maxX, maxY, minX, minY };
}

/**
 * 将 ring 转换为 SVG path 语句。
 *
 * @param rings ring 列表。
 * @returns path d 字符串。
 */
function buildPathData(rings: Ring[]): string {
  const { maxX, maxY, minX, minY } = computeBounds(rings);
  const dx = Math.max(maxX - minX, 1e-8);
  const dy = Math.max(maxY - minY, 1e-8);
  const availableSize = SVG_CANVAS_SIZE - SVG_PADDING * 2;
  const scale = Math.min(availableSize / dx, availableSize / dy);
  const projectedWidth = dx * scale;
  const projectedHeight = dy * scale;
  const offsetX = (SVG_CANVAS_SIZE - projectedWidth) / 2;
  const offsetY = (SVG_CANVAS_SIZE - projectedHeight) / 2;

  const projectPoint = ([x, y]: Point): Point => [
    (x - minX) * scale + offsetX,
    (maxY - y) * scale + offsetY,
  ];

  const commands: string[] = [];
  for (const ring of rings) {
    if (ring.length < 3) {
      continue;
    }
    const projected = ring.map(projectPoint);
    const [firstX, firstY] = projected[0];
    commands.push(`M ${firstX.toFixed(2)} ${firstY.toFixed(2)}`);
    for (let i = 1; i < projected.length; i += 1) {
      const [x, y] = projected[i];
      commands.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    commands.push('Z');
  }

  return commands.join(' ');
}

/**
 * 构建边界 SVG。
 *
 * @param input 生成输入。
 * @returns SVG 结果。
 */
export function buildBoundarySvg(
  input: BoundarySvgBuildInput,
): BoundarySvgBuildResult {
  const rings = collectRings(input.boundaryData);
  if (!rings.length) {
    throw new Error('边界数据不包含可绘制的 Polygon/MultiPolygon。');
  }

  const style: BoundarySvgStyle = {
    ...DEFAULT_BOUNDARY_SVG_STYLE,
    ...(input.style ?? {}),
  };

  const pathData = buildPathData(rings);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_CANVAS_SIZE} ${SVG_CANVAS_SIZE}" width="${SVG_CANVAS_SIZE}" height="${SVG_CANVAS_SIZE}" preserveAspectRatio="xMidYMid meet">`,
    '<rect width="100%" height="100%" fill="#ffffff" />',
    `<path d="${pathData}" fill="${style.fillColor}" stroke="${style.strokeColor}" stroke-width="${style.strokeWidth}" />`,
    '</svg>',
  ].join('');

  return { style, svg };
}

/**
 * LangChain Tool：根据边界数据生成 SVG。
 */
export const boundarySvgTool = new DynamicTool({
  name: 'boundary_svg_build',
  description:
    'Build SVG from boundary GeoJSON (Polygon/MultiPolygon). Input JSON: {"boundaryData":{...},"style":{"fillColor":"#ff0000","strokeColor":"#000000"}}',
  func: (input: string): Promise<string> => {
    const parsed = JSON.parse(input) as BoundarySvgBuildInput;
    return Promise.resolve(JSON.stringify(buildBoundarySvg(parsed)));
  },
});
