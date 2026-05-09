import { ChatOpenAI } from '@langchain/openai';
import type { createLangChainLocalTraceConfig } from './langchain-local-trace';

/**
 * 模型流式文本分片回调签名。
 */
export type StreamChunkHandler = (chunk: string) => void | Promise<void>;

/**
 * 公共流式消费输入参数。
 */
export interface StreamAndCollectInput {
  /** 已配置好的聊天模型实例。 */
  model: ChatOpenAI;
  /** 发送给模型的消息数组。 */
  messages: Parameters<ChatOpenAI['stream']>[0];
  /** 每次拿到文本分片时的回调。 */
  onChunk: StreamChunkHandler;
  /** 将 chunk.content 归一化为纯文本。 */
  extractText: (chunkContent: unknown) => string;
  /** 可选调试与追踪配置。 */
  runConfig?: ReturnType<typeof createLangChainLocalTraceConfig>;
}
