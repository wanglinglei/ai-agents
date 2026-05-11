import { DynamicTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import {
  getOpenAIApiKey,
  getOpenAICompatibleBaseUrl,
  getOpenAIModelName,
} from '../../../common/config/runtime-env.config';
import { createLangChainLocalTraceConfig } from '../../../common/langchain/langchain-local-trace';

/**
 * 用户 SVG 样式修改请求。
 */
export interface SvgStyleIntent {
  /** 填充色。 */
  fillColor?: string;
  /** 描边色。 */
  strokeColor?: string;
}

const COLOR_ALIAS: Record<string, string> = {
  白色: '#ffffff',
  白: '#ffffff',
  黑色: '#000000',
  黑: '#000000',
  红色: '#ff0000',
  红: '#ff0000',
  蓝色: '#0000ff',
  蓝: '#0000ff',
  绿色: '#008000',
  绿: '#008000',
  黄色: '#ffff00',
  黄: '#ffff00',
  灰色: '#808080',
  灰: '#808080',
  橙色: '#ffa500',
  橙: '#ffa500',
  紫色: '#800080',
  紫: '#800080',
};
const DEFAULT_STYLE_PARSE_MODEL = 'qw-plus';
const STYLE_PARSE_TEMPERATURE = 0;

/**
 * 将原始颜色词归一化为可用于 SVG 的颜色值。
 *
 * @param rawColor 原始颜色词。
 * @returns 标准颜色值，不可识别时返回 undefined。
 */
function normalizeColor(rawColor: string): string | undefined {
  const trimmed = rawColor.trim().toLowerCase();

  if (!trimmed) {
    return undefined;
  }

  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) {
    return trimmed;
  }

  if (/^[a-z]+$/.test(trimmed)) {
    return trimmed;
  }

  return COLOR_ALIAS[rawColor.trim()];
}

/**
 * 从语句中提取某类颜色意图。
 *
 * @param message 用户输入。
 * @param keywords 属性关键词。
 * @returns 提取到的颜色值。
 */
function extractColorByKeywords(
  message: string,
  keywords: string[],
): string | undefined {
  const joined = keywords.join('|');
  const colorToken = '([#a-zA-Z0-9]+|[\\u4e00-\\u9fa5]{1,6}(?:色)?)';
  const explicitPattern = new RegExp(
    `(?:${joined})[^，。；;:：\\n]{0,20}?(?:修改为|改为|改成|设置为|设为|变成|变为|调整为|为)\\s*${colorToken}`,
    'i',
  );
  const compactPattern = new RegExp(`(?:${joined})\\s*${colorToken}`, 'i');
  const match = message.match(explicitPattern) ?? message.match(compactPattern);

  if (!match?.[1]) {
    return undefined;
  }

  return normalizeColor(match[1]);
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
 * 基于大模型解析 SVG 样式意图。
 *
 * @param message 用户输入。
 * @returns 样式解析结果，失败时返回 undefined。
 */
async function parseSvgStyleIntentByModel(
  message: string,
): Promise<SvgStyleIntent | undefined> {
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
      model: getOpenAIModelName(DEFAULT_STYLE_PARSE_MODEL),
      temperature: STYLE_PARSE_TEMPERATURE,
    });

    const response = await model.invoke(
      [
        {
          role: 'system',
          content: [
            '你是 SVG 样式意图解析器。',
            '请从用户输入中提取 fillColor 与 strokeColor。',
            '输出必须是 JSON 对象，且只包含 fillColor 与 strokeColor 两个字段。',
            '字段值必须是字符串颜色值（如 #ff0000、red、红色）或 null。',
            '禁止输出任何解释、Markdown 或额外字段。',
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
          phase: 'style-intent-parse',
          tool: 'svg_style_intent_parse',
        },
        runName: 'boundary-svg.style-intent-parse.model.invoke',
        tags: ['boundary-svg', 'tool'],
      }),
    );

    const parsed = tryParseJsonObject(getModelMessage(response));
    if (!parsed) {
      return undefined;
    }

    const rawFillColor =
      typeof parsed.fillColor === 'string' ? parsed.fillColor : undefined;
    const rawStrokeColor =
      typeof parsed.strokeColor === 'string' ? parsed.strokeColor : undefined;
    const fillColor = rawFillColor ? normalizeColor(rawFillColor) : undefined;
    const strokeColor = rawStrokeColor
      ? normalizeColor(rawStrokeColor)
      : undefined;

    if (!fillColor && !strokeColor) {
      return undefined;
    }

    return {
      ...(fillColor ? { fillColor } : {}),
      ...(strokeColor ? { strokeColor } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * 解析用户“修改 SVG 样式”语句，抽取填充色和描边色。
 *
 * @param input 工具输入文本。
 * @returns 结构化样式补丁。
 */
export async function parseSvgStyleIntent(
  input: string,
): Promise<SvgStyleIntent> {
  const message = input.trim();

  if (!message) {
    return {};
  }

  const fillColor = extractColorByKeywords(message, ['填充色', '填充']);
  const strokeColor = extractColorByKeywords(message, [
    '描边',
    '描边色',
    '边框',
    '线条',
  ]);

  if (fillColor || strokeColor) {
    return {
      ...(fillColor ? { fillColor } : {}),
      ...(strokeColor ? { strokeColor } : {}),
    };
  }

  const modelParsedIntent = await parseSvgStyleIntentByModel(message);
  if (!modelParsedIntent) {
    return {};
  }

  return modelParsedIntent;
}

/**
 * LangChain Tool：解析 SVG 样式修改意图。
 */
export const svgStyleIntentParseTool = new DynamicTool({
  name: 'svg_style_intent_parse',
  description:
    'Parse SVG style update text. Extract fillColor and strokeColor from Chinese instructions like "填充红色，描边黑色".',
  func: async (input: string): Promise<string> =>
    JSON.stringify(await parseSvgStyleIntent(input)),
});
