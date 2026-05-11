import { Injectable } from '@nestjs/common';
import { createLangChainLocalTraceConfig } from '../../common/langchain/langchain-local-trace';
import { getOpenAIModelName } from '../../common/config/runtime-env.config';

const BOUNDARY_SVG_AGENT_KEY = 'boundary-svg';

/**
 * boundary-svg 模型与本地 trace 配置服务。
 */
@Injectable()
export class BoundarySvgModelService {
  /**
   * 获取 boundary-svg 默认模型名称。
   *
   * @returns 模型名称。
   */
  getResponseModelName(): string {
    return getOpenAIModelName('qw-plus');
  }

  /**
   * 创建 boundary-svg 的调试运行配置。
   *
   * @param runName 运行名称。
   * @param metadata 运行元信息。
   * @returns 本地 trace 配置或 undefined。
   */
  createDebugRunConfig(
    runName: string,
    metadata: Record<string, unknown> = {},
  ): ReturnType<typeof createLangChainLocalTraceConfig> {
    return createLangChainLocalTraceConfig({
      metadata: {
        agent: BOUNDARY_SVG_AGENT_KEY,
        model: this.getResponseModelName(),
        ...metadata,
      },
      runName,
      tags: ['boundary-svg'],
    });
  }
}
