import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { RunnableConfig } from '@langchain/core/runnables';

const LANGCHAIN_LOCAL_TRACE_ENABLED_VALUE = 'true';

interface LocalTraceConfigInput {
  metadata?: Record<string, unknown>;
  runName: string;
  tags?: string[];
}

/**
 * 判断是否启用 LangChain 本地调试日志。
 *
 * @returns 本地调试日志开关状态。
 */
export function isLangChainLocalTraceEnabled(): boolean {
  return process.env.LANGCHAIN_LOCAL_TRACE === LANGCHAIN_LOCAL_TRACE_ENABLED_VALUE;
}

/**
 * 构建 LangChain 本地调试配置。
 *
 * @param input 运行名称、标签和附加元数据。
 * @returns 启用本地调试时返回 runnable 配置，否则返回 undefined。
 */
export function createLangChainLocalTraceConfig(
  input: LocalTraceConfigInput,
): RunnableConfig | undefined {
  if (!isLangChainLocalTraceEnabled()) {
    return undefined;
  }

  return {
    callbacks: [createLocalTraceHandler()],
    metadata: input.metadata,
    runName: input.runName,
    tags: input.tags,
  };
}

/**
 * 生成简洁的 LangChain 控制台日志处理器。
 *
 * @returns 打印 agent/tool/llm 执行过程的 callback handler。
 */
function createLocalTraceHandler(): BaseCallbackHandler {
  return BaseCallbackHandler.fromMethods({
    handleAgentAction(action) {
      console.log(`[langchain:agent] Calling tool: ${action.tool}`);
    },
    handleAgentEnd() {
      console.log('[langchain:agent] Finished');
    },
    handleChainStart(_chain, _inputs, _runId, _runType, _tags, _metadata, runName) {
      console.log(`[langchain:chain] Start: ${runName || 'unnamed-chain'}`);
    },
    handleChainEnd() {
      console.log('[langchain:chain] End');
    },
    handleLLMStart(_llm, _prompts, _runId, _parentRunId, _extraParams, _tags, _metadata, runName) {
      console.log(`[langchain:llm] Thinking... (${runName || 'chat-model'})`);
    },
    handleLLMEnd() {
      console.log('[langchain:llm] Completed');
    },
    handleToolEnd(output) {
      console.log(`[langchain:tool] Result: ${stringifyToolResult(output)}`);
    },
    handleToolStart(_tool, input, _runId, _parentRunId, _tags, _metadata, runName) {
      console.log(`[langchain:tool] Start: ${runName || 'tool'} input=${input}`);
    },
  });
}

/**
 * 将工具输出压缩为便于阅读的单行文本。
 *
 * @param output 工具执行输出。
 * @returns 最多 200 字符的日志文本。
 */
function stringifyToolResult(output: unknown): string {
  const raw =
    typeof output === 'string' ? output : JSON.stringify(output ?? null);
  const normalized = raw.replace(/\s+/g, ' ').trim();

  if (normalized.length <= 200) {
    return normalized;
  }

  return `${normalized.slice(0, 200)}...`;
}
