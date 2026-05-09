import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { RunnableConfig } from '@langchain/core/runnables';
import chalk from 'chalk';

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
  return (
    process.env.LANGCHAIN_LOCAL_TRACE === LANGCHAIN_LOCAL_TRACE_ENABLED_VALUE
  );
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
  const llmRunStartAt = new Map<string, number>();
  const chainRunStartAt = new Map<string, number>();
  const toolRunState = new Map<
    string,
    {
      name: string;
      startAt: number;
    }
  >();

  return BaseCallbackHandler.fromMethods({
    handleAgentAction(action) {
      console.log(
        `${colorizeTag('agent')} Calling tool: ${String(action.tool)}`,
      );
    },
    handleAgentEnd() {
      console.log(`${colorizeTag('agent')} Finished`);
    },
    handleChainStart(
      _chain,
      _inputs,
      runId,
      _runType,
      _tags,
      _metadata,
      runName,
    ) {
      chainRunStartAt.set(runId, Date.now());
      console.log(
        `${colorizeTag('chain')} Start: ${runName || 'unnamed-chain'}`,
      );
    },
    handleChainEnd(_outputs, runId) {
      const durationMs = getDurationMs(chainRunStartAt, runId);
      console.log(`${colorizeTag('chain')} End${formatDuration(durationMs)}`);
    },
    handleLLMStart(
      _llm,
      _prompts,
      runId,
      _parentRunId,
      _extraParams,
      _tags,
      _metadata,
      runName,
    ) {
      llmRunStartAt.set(runId, Date.now());
      console.log(
        `${colorizeTag('llm')} Thinking... (${runName || 'chat-model'})`,
      );
    },
    handleLLMEnd(_output, runId) {
      const durationMs = getDurationMs(llmRunStartAt, runId);
      console.log(
        `${colorizeTag('llm')} Completed${formatDuration(durationMs)}`,
      );
    },
    handleToolEnd(output, runId) {
      const toolState = toolRunState.get(runId);
      const durationMs = getDurationMsByStartAt(
        toolState?.startAt,
        runId,
        toolRunState,
      );
      const toolName = toolState?.name || 'tool';
      console.log(
        `${colorizeTag('tool')} End: ${toolName}${formatDuration(durationMs)} result=${stringifyToolResult(output)}`,
      );
    },
    handleToolStart(
      tool,
      input,
      runId,
      _parentRunId,
      _tags,
      metadata,
      runName,
    ) {
      const toolName = resolveToolName(tool, runName, metadata);
      toolRunState.set(runId, {
        name: toolName,
        startAt: Date.now(),
      });
      console.log(`${colorizeTag('tool')} Start: ${toolName} input=${input}`);
    },
    handleToolError(error, runId) {
      const toolState = toolRunState.get(runId);
      const durationMs = getDurationMsByStartAt(
        toolState?.startAt,
        runId,
        toolRunState,
      );
      const toolName = toolState?.name || 'tool';
      const message = error instanceof Error ? error.message : String(error);
      console.log(
        `${colorizeTag('tool')} Error: ${toolName}${formatDuration(durationMs)} message=${message}`,
      );
    },
  });
}

/**
 * 为不同 run 类型渲染彩色标签。
 *
 * @param type 日志分类。
 * @returns 带 ANSI 颜色的标签文本。
 */
function colorizeTag(type: 'agent' | 'chain' | 'llm' | 'tool'): string {
  const rawTag = `[langchain:${type}]`;
  if (type === 'agent') {
    return chalk.cyan(rawTag);
  }

  if (type === 'chain') {
    return chalk.magenta(rawTag);
  }

  if (type === 'llm') {
    return chalk.green(rawTag);
  }

  return chalk.yellow(rawTag);
}

/**
 * 将耗时毫秒格式化为日志后缀。
 *
 * @param durationMs 计算得到的耗时毫秒。
 * @returns 统一格式的耗时文本。
 */
function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return '';
  }

  return ` duration=${durationMs}ms`;
}

/**
 * 根据开始时间计算耗时并清理运行状态。
 *
 * @param startAt 开始时间戳。
 * @param runId LangChain 本次运行 ID。
 * @param runStateMap 运行状态映射。
 * @returns 运行耗时毫秒。
 */
function getDurationMsByStartAt<T>(
  startAt: number | undefined,
  runId: string,
  runStateMap: Map<string, T>,
): number | undefined {
  runStateMap.delete(runId);

  if (startAt === undefined) {
    return undefined;
  }

  return Date.now() - startAt;
}

/**
 * 从运行状态映射中读取开始时间并计算耗时。
 *
 * @param runStateMap 运行状态映射。
 * @param runId LangChain 本次运行 ID。
 * @returns 运行耗时毫秒。
 */
function getDurationMs(
  runStateMap: Map<string, number>,
  runId: string,
): number | undefined {
  const startedAt = runStateMap.get(runId);
  runStateMap.delete(runId);

  if (startedAt === undefined) {
    return undefined;
  }

  return Date.now() - startedAt;
}

/**
 * 从工具序列化信息中提取可读名称。
 *
 * @param tool LangChain 传入的工具序列化对象。
 * @param runName 回调中的运行名称。
 * @returns 优先使用工具名，失败时回退到 runName。
 */
function resolveToolName(
  tool: unknown,
  runName?: string,
  metadata?: unknown,
): string {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  if (isRecord(tool)) {
    const directName = tool.name;
    if (typeof directName === 'string' && directName.trim()) {
      return directName.trim();
    }

    const id = tool.id;
    if (Array.isArray(id) && id.length > 0) {
      const last: unknown = id[id.length - 1];
      if (typeof last === 'string' && last.trim()) {
        return last.trim();
      }
    }
  }

  if (isRecord(metadata)) {
    const metadataTool = metadata.tool;
    if (typeof metadataTool === 'string' && metadataTool.trim()) {
      return metadataTool.trim();
    }
  }

  if (typeof runName === 'string' && runName.trim()) {
    return runName.trim();
  }

  return 'tool';
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
