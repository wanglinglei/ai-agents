import { BadRequestException, Injectable } from '@nestjs/common';
import { DynamicTool } from '@langchain/core/tools';
import { randomUUID } from 'node:crypto';
import {
  AGENT_ARTIFACT_TYPE,
  AGENT_MESSAGE_ROLE,
  AGENT_MESSAGE_STATUS,
  AgentRunPersistenceService,
  type JsonRecord,
} from '../../common/agents';
import {
  getOpenAIModelName,
  hasOpenAIApiKey,
  hasTavilyApiKey,
} from '../../common/config/runtime-env.config';
import { isLangChainLocalTraceEnabled } from '../../common/langchain/langchain-local-trace';
import { AgentPersistenceService } from '../persistence/agent-persistence.service';
import { uploadFileToBitiful } from '../tools';
import { BoundarySvgModelService } from './boundary-svg-model.service';
import { boundaryIntentParseTool } from './tools/boundary-intent-parse.tool';
import {
  boundaryBatchFetchTool,
  buildGeoJsonDownloadPayload,
  type BoundaryBatchFetchResult,
} from './tools/boundary-batch-fetch.tool';
import {
  boundaryFetchTool,
  type BoundaryFetchResult,
} from './tools/boundary-fetch.tool';
import {
  buildBoundarySvg,
  DEFAULT_BOUNDARY_SVG_STYLE,
} from './tools/boundary-svg.tool';
import {
  cityCodeSearchTool,
  type CityCodeSearchResult,
} from './tools/city-code-search.tool';
import {
  svgStyleIntentParseTool,
  type SvgStyleIntent,
} from './tools/svg-style-intent-parse.tool';
import type {
  BoundarySvgAgentResponse,
  BoundarySvgAgentStatus,
  BoundarySvgConversationContext,
  BoundarySvgIntent,
  BoundarySvgStyle,
} from './types/boundary-svg-agent.types';

const AGENT_KEY = 'boundary-svg';
const CONTEXT_TTL_MS = 10 * 60 * 1000;
const FIXED_YEAR = 2023 as const;
const GEOJSON_CONTENT_TYPE = 'application/geo+json; charset=utf-8';

type BoundarySvgAnswerChunkHandler = (chunk: string) => void | Promise<void>;

/**
 * boundary-svg 业务编排服务。
 */
@Injectable()
export class BoundarySvgService {
  constructor(
    private readonly agentPersistence: AgentPersistenceService,
    private readonly runPersistence: AgentRunPersistenceService,
    private readonly modelService: BoundarySvgModelService,
  ) {}

  /**
   * 返回 boundary-svg Agent 运行状态。
   *
   * @returns 配置与接入状态。
   */
  getStatus(): BoundarySvgAgentStatus {
    return {
      hasApiKey: hasOpenAIApiKey(),
      hasTavilyApiKey: hasTavilyApiKey(),
      integrated: true,
      localTrace: isLangChainLocalTraceEnabled(),
      model: getOpenAIModelName('qw-plus'),
    };
  }

  /**
   * 生成或复用会话 ID。
   *
   * @param conversationId 外部传入会话 ID。
   * @returns 可用会话 ID。
   */
  resolveQueryConversationId(conversationId?: string): string {
    return conversationId?.trim() || randomUUID();
  }

  /**
   * 以流式分片方式执行 boundary-svg 查询。
   *
   * @param message 用户输入。
   * @param conversationId 会话 ID。
   * @param onAnswerChunk 回答分片回调。
   * @returns 结构化响应。
   */
  async streamQuery(
    message: string,
    conversationId: string | undefined,
    onAnswerChunk: BoundarySvgAnswerChunkHandler,
  ): Promise<BoundarySvgAgentResponse> {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      throw new BadRequestException('请提供边界查询内容。');
    }

    const activeConversationId =
      this.resolveQueryConversationId(conversationId);

    await this.agentPersistence.ensureConversation({
      agentKey: AGENT_KEY,
      conversationId: activeConversationId,
      initialMessage: normalizedMessage,
    });

    const userMessage = await this.agentPersistence.createMessage({
      content: normalizedMessage,
      conversationId: activeConversationId,
      role: AGENT_MESSAGE_ROLE.USER,
    });

    const run = await this.agentPersistence.createRun({
      agentKey: AGENT_KEY,
      conversationId: activeConversationId,
      input: {
        message: normalizedMessage,
      },
      model: getOpenAIModelName('qw-plus'),
      provider: 'Tavily+RuiDuoBao',
      userMessageId: userMessage.id,
    });

    try {
      this.logAgentEvent('Start: boundary-svg.query');
      const response = await this.handleQuery(
        normalizedMessage,
        activeConversationId,
      );
      await onAnswerChunk(response.answer);

      await this.runPersistence.persistSuccessfulRun({
        answer: response.answer,
        artifact: {
          artifactType: AGENT_ARTIFACT_TYPE.BOUNDARY_SVG_RESULT,
          data: this.toJsonRecord({
            boundaryData: response.boundaryData,
            cityCode: response.cityCode,
            cityName: response.cityName,
            geojsonDownload: response.geojsonDownload,
            geojsonStorage: response.geojsonStorage,
            svg: response.svg,
            svgStyle: response.svgStyle,
            year: response.year,
          }),
          metadata: this.toJsonRecord({
            cityCode: response.cityCode,
            cityName: response.cityName,
            hasGeojsonDownload: Boolean(response.geojsonDownload),
            hasGeojsonStorage: Boolean(response.geojsonStorage),
            needSvg: response.needSvg,
            status: response.status,
          }),
          title: `${response.cityName ?? '未知城市'}边界结果`,
        },
        artifactMessageMetadataKey: 'boundaryArtifactId',
        conversationId: activeConversationId,
        messageMetadata: this.toJsonRecord({
          cityCode: response.cityCode,
          cityName: response.cityName,
          ...(response.geojsonStorage
            ? {
                geojsonStorageBucket: response.geojsonStorage.bucket,
                geojsonStorageKey: response.geojsonStorage.key,
                geojsonStorageUrl: response.geojsonStorage.publicUrl,
              }
            : {}),
          model: response.model,
          needSvg: response.needSvg,
          status: response.status,
          svgStyle: response.svgStyle,
          year: response.year,
        }),
        messageStatus: AGENT_MESSAGE_STATUS.COMPLETED,
        runId: run.id,
        buildOutput: (artifactId) => ({
          answer: response.answer,
          artifactId,
          cityCode: response.cityCode,
          cityName: response.cityName,
          ...(response.geojsonStorage
            ? {
                geojsonStorageUrl: response.geojsonStorage.publicUrl,
                geojsonStorageKey: response.geojsonStorage.key,
              }
            : {}),
          ...(response.geojsonDownload
            ? {
                geojsonDownloadFileName: response.geojsonDownload.fileName,
                geojsonDownloadMimeType: response.geojsonDownload.mimeType,
              }
            : {}),
          needSvg: response.needSvg,
          status: response.status,
          year: response.year,
        }),
      });

      await this.saveConversationContext(activeConversationId, {
        lastBoundaryData: response.boundaryData,
        lastCityCode: response.cityCode,
        lastCityName: response.cityName,
        lastNeedSvg: response.needSvg,
        lastSvg: response.svg,
        lastSvgStyle: response.svgStyle,
      });
      this.logAgentEvent('Finished: boundary-svg.query');

      return response;
    } catch (error) {
      const answer =
        error instanceof Error ? error.message : '边界查询失败，请稍后再试。';
      await onAnswerChunk(answer);

      await this.runPersistence.persistFailedRun({
        answer,
        conversationId: activeConversationId,
        error: this.serializeError(error),
        messageMetadata: {
          model: getOpenAIModelName('qw-plus'),
          question: normalizedMessage,
          status: 'failed',
          year: FIXED_YEAR,
        },
        messageStatus: AGENT_MESSAGE_STATUS.FAILED,
        runId: run.id,
      });
      this.logAgentEvent('Finished: boundary-svg.query (failed)');

      return {
        answer,
        conversationId: activeConversationId,
        model: getOpenAIModelName('qw-plus'),
        needSvg: false,
        question: normalizedMessage,
        status: 'failed',
        year: FIXED_YEAR,
      };
    }
  }

  /**
   * 执行核心查询逻辑：新查询或样式修改。
   *
   * @param message 用户输入。
   * @param conversationId 会话 ID。
   * @returns 结构化响应。
   */
  private async handleQuery(
    message: string,
    conversationId: string,
  ): Promise<BoundarySvgAgentResponse> {
    const context = await this.getConversationContext(conversationId);
    const intent = await this.invokeJsonTool<BoundarySvgIntent>(
      boundaryIntentParseTool,
      message,
      'boundary-svg.tool.intent-parse',
      {
        phase: 'parse-intent',
      },
    );

    if (intent.action === 'update_svg_style') {
      if (!context?.lastBoundaryData) {
        throw new BadRequestException(
          '当前会话没有可修改的 SVG。请先查询一次城市边界并生成 SVG。',
        );
      }

      const stylePatch = await this.invokeJsonTool<SvgStyleIntent>(
        svgStyleIntentParseTool,
        message,
        'boundary-svg.tool.style-intent-parse',
        {
          phase: 'parse-style',
        },
      );
      const mergedStyle = this.mergeSvgStyle(context.lastSvgStyle, stylePatch);
      const svgResult = buildBoundarySvg({
        boundaryData: context.lastBoundaryData,
        style: mergedStyle,
      });

      const answer = this.buildAnswerWithSvg(
        `已按要求更新 SVG 样式：填充色 ${svgResult.style.fillColor}，描边色 ${svgResult.style.strokeColor}。`,
        svgResult.svg,
      );
      return {
        answer,
        boundaryData: context.lastBoundaryData,
        cityCode: context.lastCityCode,
        cityName: context.lastCityName,
        conversationId,
        model: getOpenAIModelName('qw-plus'),
        needSvg: true,
        question: message,
        status: 'success',
        svg: svgResult.svg,
        svgStyle: svgResult.style,
        year: FIXED_YEAR,
      };
    }

    const explicitCityCode = intent.cityCode;
    const cityName = intent.cityName || context?.lastCityName;
    if (!cityName && !explicitCityCode) {
      throw new BadRequestException('未识别到城市名称，请明确指定城市。');
    }

    const cityCodeResult = explicitCityCode
      ? {
          cityCode: explicitCityCode,
          cityName: cityName ?? '',
          source: 'explicit_input' as const,
        }
      : await this.invokeJsonTool<CityCodeSearchResult>(
          cityCodeSearchTool,
          JSON.stringify({ cityName: cityName! }),
          'boundary-svg.tool.city-code-search',
          {
            phase: 'resolve-city-code',
          },
        );
    const boundaryResult = intent.needSvg
      ? await this.invokeJsonTool<BoundaryBatchFetchResult>(
          boundaryBatchFetchTool,
          JSON.stringify({
            cityCode: cityCodeResult.cityCode,
          }),
          'boundary-svg.tool.boundary-batch-fetch',
          {
            phase: 'fetch-boundary-batch',
          },
        )
      : await this.invokeJsonTool<BoundaryFetchResult>(
          boundaryFetchTool,
          JSON.stringify({
            cityCode: cityCodeResult.cityCode,
          }),
          'boundary-svg.tool.boundary-fetch',
          {
            phase: 'fetch-boundary',
          },
        );

    let svg: string | undefined;
    let svgStyle: BoundarySvgStyle | undefined;
    const geojsonStorage = await this.uploadBoundaryGeoJson(
      cityCodeResult.cityCode,
      boundaryResult.boundaryData,
    );
    let geojsonDownload:
      | {
          fileName: string;
          mimeType: string;
          fileContent: string;
        }
      | undefined;

    if (intent.needSvg) {
      let stylePatch: Partial<BoundarySvgStyle> = {};
      try {
        stylePatch = await this.invokeJsonTool<SvgStyleIntent>(
          svgStyleIntentParseTool,
          message,
          'boundary-svg.tool.style-intent-parse',
          {
            phase: 'parse-style',
          },
        );
      } catch {
        stylePatch = {};
      }

      const svgResult = buildBoundarySvg({
        boundaryData: boundaryResult.boundaryData,
        style: this.mergeSvgStyle(context?.lastSvgStyle, stylePatch),
      });
      svg = svgResult.svg;
      svgStyle = svgResult.style;
    } else {
      geojsonDownload = buildGeoJsonDownloadPayload(
        cityCodeResult.cityCode,
        boundaryResult.boundaryData,
      );
    }

    const resolvedCityName = cityName || context?.lastCityName;
    const answer = intent.needSvg
      ? this.buildAnswerWithSvg(
          `已获取 ${resolvedCityName ?? '目标城市'}（编码 ${cityCodeResult.cityCode}）${FIXED_YEAR} 年边界数据并生成 SVG。`,
          svg,
        )
      : `已获取 ${resolvedCityName ?? '目标城市'}（编码 ${cityCodeResult.cityCode}）${FIXED_YEAR} 年边界数据，并已返回 GeoJSON 文件内容供下载。`;

    return {
      answer,
      boundaryData: boundaryResult.boundaryData,
      cityCode: cityCodeResult.cityCode,
      cityName: resolvedCityName,
      conversationId,
      model: getOpenAIModelName('qw-plus'),
      needSvg: intent.needSvg,
      question: message,
      status: 'success',
      geojsonStorage,
      ...(geojsonDownload ? { geojsonDownload } : {}),
      ...(svg ? { svg } : {}),
      ...(svgStyle ? { svgStyle } : {}),
      year: FIXED_YEAR,
    };
  }

  /**
   * 合并 SVG 样式：优先级为 patch > previous > 默认。
   *
   * @param previous 上一轮样式。
   * @param patch 本轮样式补丁。
   * @returns 合并后样式。
   */
  private mergeSvgStyle(
    previous: BoundarySvgStyle | undefined,
    patch: Partial<BoundarySvgStyle>,
  ): BoundarySvgStyle {
    return {
      ...DEFAULT_BOUNDARY_SVG_STYLE,
      ...(previous ?? {}),
      ...patch,
    };
  }

  /**
   * 上传边界 GeoJSON 内容到对象存储。
   *
   * @param cityCode 城市编码。
   * @param boundaryData GeoJSON 边界对象。
   * @returns 存储结果元数据。
   */
  private async uploadBoundaryGeoJson(
    cityCode: string,
    boundaryData: JsonRecord,
  ) {
    return uploadFileToBitiful({
      content: JSON.stringify(boundaryData),
      contentType: GEOJSON_CONTENT_TYPE,
      fileName: `${cityCode}-${Date.now()}.geojson`,
    });
  }

  /**
   * 读取会话上下文并做 TTL 校验。
   *
   * @param conversationId 会话 ID。
   * @returns 上下文快照。
   */
  private async getConversationContext(
    conversationId: string,
  ): Promise<BoundarySvgConversationContext | undefined> {
    const context =
      await this.agentPersistence.getConversationState<BoundarySvgConversationContext>(
        AGENT_KEY,
        conversationId,
      );

    if (!context || typeof context.updatedAt !== 'number') {
      return undefined;
    }

    if (Date.now() - context.updatedAt > CONTEXT_TTL_MS) {
      return undefined;
    }

    return context;
  }

  /**
   * 保存会话上下文。
   *
   * @param conversationId 会话 ID。
   * @param context 上下文内容。
   */
  private async saveConversationContext(
    conversationId: string,
    context: Omit<BoundarySvgConversationContext, 'updatedAt'>,
  ): Promise<void> {
    await this.agentPersistence.updateConversationState({
      conversationId,
      state: {
        ...context,
        updatedAt: Date.now(),
      },
    });
  }

  /**
   * 序列化错误对象。
   *
   * @param error 任意错误。
   * @returns 可持久化错误结构。
   */
  private serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    }

    return {
      message: String(error),
    };
  }

  /**
   * 将任意对象转换为可存储 JSON。
   *
   * @param value 任意值。
   * @returns JSON 对象。
   */
  private toJsonRecord(value: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }

  /**
   * 在回答文本中附带 SVG 内容，便于前端直接提取并预览。
   *
   * @param answer 面向用户的回答文本。
   * @param svg 生成的 SVG 字符串。
   * @returns 包含 SVG 的最终回答。
   */
  private buildAnswerWithSvg(answer: string, svg?: string): string {
    if (!svg) {
      return answer;
    }

    return `${answer}\n\n${svg}`;
  }

  /**
   * 统一执行 boundary-svg 的 DynamicTool，并解析 JSON 字符串输出。
   *
   * @param tool 目标工具。
   * @param input 工具输入。
   * @param runName 本次 trace 运行名。
   * @param metadata trace 元信息。
   * @returns 反序列化后的结构化结果。
   */
  private async invokeJsonTool<TOutput>(
    tool: DynamicTool,
    input: string,
    runName: string,
    metadata: Record<string, unknown>,
  ): Promise<TOutput> {
    this.logAgentEvent(`Calling tool: ${tool.name}`);
    const output: unknown = await tool.invoke(
      input,
      this.modelService.createDebugRunConfig(runName, metadata),
    );

    if (typeof output !== 'string') {
      throw new BadRequestException(`${tool.name} 返回值不是字符串。`);
    }

    try {
      return JSON.parse(output) as TOutput;
    } catch {
      throw new BadRequestException(`${tool.name} 返回值不是合法 JSON。`);
    }
  }

  /**
   * 在本地 trace 开启时打印 boundary-svg 的 agent 级调用日志。
   *
   * @param message 日志文本。
   */
  private logAgentEvent(message: string): void {
    if (!isLangChainLocalTraceEnabled()) {
      return;
    }

    console.log(`[langchain:agent] ${message}`);
  }
}
