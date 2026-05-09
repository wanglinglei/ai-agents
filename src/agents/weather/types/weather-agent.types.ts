import type { WeatherResult } from '../tools/weather.tool';

/**
 * 天气 Agent 从用户自然语言中解析出的完整查询意图。
 */
export interface WeatherIntent {
  /** 用户要查询的城市名称。 */
  city: string;
  /** 标准化后的查询日期，格式为 YYYY-MM-DD。 */
  date: string;
  /** 用户表达中的日期文本，用于生成自然语言回答。 */
  dateText: string;
  /** 用户附加的生活场景或决策诉求，例如穿衣、出行、洗车等。 */
  demand?: string;
}

/**
 * 天气 Agent 对外响应的业务状态。
 */
export type WeatherAgentResponseStatus =
  | 'failed'
  | 'need_clarification'
  | 'success';

/**
 * 天气 Agent 当前集成与配置状态。
 */
export interface WeatherAgentStatus {
  /** 是否已配置可用于调用模型的 API Key。 */
  hasApiKey: boolean;
  /** 天气 Agent 功能是否已接入当前服务。 */
  integrated: boolean;
  /** 本地 LangChain 调试日志是否已启用。 */
  localTrace: boolean;
  /** 当前配置的模型名称。 */
  model: string;
  /** 天气数据提供方名称。 */
  provider: string;
}

/**
 * 天气查询接口返回给调用方的统一响应结构。
 */
export interface WeatherAgentResponse {
  /** 面向用户的自然语言回答。 */
  answer: string;
  /** 已识别或已补齐的城市名称。 */
  city?: string;
  /** 多轮天气查询使用的会话 ID。 */
  conversationId?: string;
  /** 标准化后的查询日期。 */
  date?: string;
  /** 用户表达中的日期文本。 */
  dateText?: string;
  /** 完整天气查询意图，成功查询时返回。 */
  intent?: WeatherIntent;
  /** 需要用户补充的参数名列表。 */
  missingParams?: string[];
  /** 本次回答使用的模型名称。 */
  model: string | null;
  /** 已解析但尚未补齐的部分天气意图。 */
  partialIntent?: Partial<WeatherIntent>;
  /** 用户本轮原始问题。 */
  question: string;
  /** 本次天气查询响应状态。 */
  status: WeatherAgentResponseStatus;
  /** 标准化后的天气数据，成功查询时返回。 */
  weather?: WeatherResult;
}

/**
 * 存储在内存中的多轮天气查询上下文。
 */
export interface WeatherConversationContext {
  /** 最近一次用户生活场景或决策诉求。 */
  lastDemand?: string;
  /** 最近一次完整天气查询意图。 */
  lastIntent?: WeatherIntent;
  /** 最近一次用于上下文衔接的用户问题。 */
  lastQuestion: string;
  /** 最近一次成功查询到的天气数据。 */
  lastWeather?: WeatherResult;
  /** 当前会话仍缺失的参数名列表。 */
  missingParams: string[];
  /** 当前会话已识别但尚未补齐的天气意图。 */
  partialIntent: Partial<WeatherIntent>;
  /** 上下文最近更新时间戳，用于过期清理。 */
  updatedAt: number;
}

/**
 * 单日天气预报数据结构，来源于标准化天气结果中的 forecast 数组。
 */
export type WeatherForecastDay = WeatherResult['forecast'][number];

/**
 * 工具调用型天气 Agent 的结构化运行结果。
 */
export type WeatherAgentRunResult =
  | {
      /** 表示已完成天气查询并可以直接回答。 */
      action: 'answer';
      /** Agent 生成的回答草稿。 */
      answer: string;
      /** 完整天气查询意图。 */
      intent: WeatherIntent;
      /** 本轮查询得到的天气数据。 */
      weather: WeatherResult;
    }
  | {
      /** 表示可复用上一轮天气数据，仅重新生成需求相关回答。 */
      action: 'reuse';
      /** Agent 生成的回答草稿。 */
      answer: string;
      /** 与上一轮天气数据匹配的完整查询意图。 */
      intent: WeatherIntent;
    }
  | {
      /** 表示缺少必要参数，需要追问用户。 */
      action: 'clarify';
      /** Agent 生成的追问草稿。 */
      answer: string;
      /** 已识别出的部分天气意图。 */
      intent: Partial<WeatherIntent>;
      /** 需要用户补充的参数名列表。 */
      missingParams: string[];
    };

/**
 * 已完成天气查询的 Agent 结果分支。
 */
export type WeatherAgentAnswerResult = Extract<
  WeatherAgentRunResult,
  { action: 'answer' }
>;

/**
 * 需要追问补参的 Agent 结果分支。
 */
export type WeatherAgentClarificationResult = Extract<
  WeatherAgentRunResult,
  { action: 'clarify' }
>;

/**
 * 复用上一轮天气数据的 Agent 结果分支。
 */
export type WeatherAgentReuseResult = Extract<
  WeatherAgentRunResult,
  { action: 'reuse' }
>;

/**
 * 执行一次天气查询流程所需的派生上下文。
 */
export interface WeatherQueryExecutionContext {
  /** 发送给天气 Agent 的上下文增强消息。 */
  agentMessage: string;
  /** 调用 OpenAI 兼容模型所需的 API Key。 */
  apiKey: string;
  /** 当前会话已存在的天气上下文。 */
  conversationContext: WeatherConversationContext | undefined;
  /** 归一化后的会话 ID。 */
  normalizedConversationId: string | undefined;
  /** 发送给回答模型的原始需求描述。 */
  originalDemandMessage: string;
}
