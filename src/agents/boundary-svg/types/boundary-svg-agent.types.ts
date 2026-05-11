/**
 * SVG 样式配置。
 */
export interface BoundarySvgStyle {
  /** 区块填充色。 */
  fillColor: string;
  /** 区块描边色。 */
  strokeColor: string;
  /** 区块描边宽度。 */
  strokeWidth: number;
}

/**
 * boundary-svg Agent 从用户输入解析出的意图。
 */
export interface BoundarySvgIntent {
  /** 本轮请求动作：生成边界或修改 SVG 样式。 */
  action: 'generate_boundary' | 'update_svg_style';
  /** 用户输入里显式给出的城市编码。 */
  cityCode?: string;
  /** 城市名称，样式修改场景下可为空。 */
  cityName?: string;
  /** 是否需要输出 SVG。 */
  needSvg: boolean;
  /** 固定边界年份。 */
  year: 2023;
}

/**
 * boundary-svg Agent 对外响应状态。
 */
export type BoundarySvgAgentResponseStatus = 'failed' | 'success';

/**
 * boundary-svg Agent 健康与配置状态。
 */
export interface BoundarySvgAgentStatus {
  /** 是否已配置 OpenAI 兼容 API Key。 */
  hasApiKey: boolean;
  /** 是否已配置 Tavily API Key。 */
  hasTavilyApiKey: boolean;
  /** 当前 Agent 是否已接入。 */
  integrated: boolean;
  /** 是否启用本地 LangChain Trace。 */
  localTrace: boolean;
  /** 当前模型名。 */
  model: string;
}

/**
 * boundary-svg Agent 的统一响应结构。
 */
export interface BoundarySvgAgentResponse {
  /** 面向用户的最终回答文本。 */
  answer: string;
  /** 边界原始数据。 */
  boundaryData?: Record<string, unknown>;
  /** 城市编码。 */
  cityCode?: string;
  /** 城市名称。 */
  cityName?: string;
  /** 会话 ID。 */
  conversationId: string;
  /** 本轮是否需要 SVG。 */
  needSvg: boolean;
  /** 模型名称。 */
  model: string;
  /** 用户原始问题。 */
  question: string;
  /** 响应状态。 */
  status: BoundarySvgAgentResponseStatus;
  /** 生成后的 SVG 内容。 */
  svg?: string;
  /** 非 SVG 场景返回的 GeoJSON 下载内容。 */
  geojsonDownload?: {
    /** 文件名。 */
    fileName: string;
    /** MIME 类型。 */
    mimeType: string;
    /** 文件文本内容。 */
    fileContent: string;
  };
  /** GeoJSON 存储到缤纷云后的信息。 */
  geojsonStorage?: {
    /** 存储桶。 */
    bucket: string;
    /** 文件名。 */
    fileName: string;
    /** 对象 key。 */
    key: string;
    /** 公网访问地址。 */
    publicUrl: string;
    /** 文件大小（字节）。 */
    size: number;
  };
  /** SVG 样式。 */
  svgStyle?: BoundarySvgStyle;
  /** 固定边界年份。 */
  year: 2023;
}

/**
 * 会话级上下文，用于后续 SVG 样式修改。
 */
export interface BoundarySvgConversationContext {
  /** 最近一次边界数据。 */
  lastBoundaryData?: Record<string, unknown>;
  /** 最近一次城市编码。 */
  lastCityCode?: string;
  /** 最近一次城市名称。 */
  lastCityName?: string;
  /** 最近一次是否请求 SVG。 */
  lastNeedSvg?: boolean;
  /** 最近一次生成的 SVG。 */
  lastSvg?: string;
  /** 最近一次 SVG 样式。 */
  lastSvgStyle?: BoundarySvgStyle;
  /** 最近更新时间。 */
  updatedAt: number;
}
