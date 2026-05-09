import { BadRequestException, Injectable } from '@nestjs/common';
import { createAgent } from 'langchain';
import { AGENT_MESSAGE_ROLE } from '../../common/agents';
import { AgentPersistenceService } from '../persistence/agent-persistence.service';
import { isLangChainLocalTraceEnabled } from '../../common/langchain/langchain-local-trace';
import { buildWeatherAgentSystemPrompt } from './prompts/weather-agent.prompt';
import { cityLookupTool } from './tools/city-lookup.tool';
import { weatherTool } from './tools/weather.tool';
import type {
  WeatherAgentResponse,
  WeatherAgentRunResult,
  WeatherAgentStatus,
  WeatherQueryExecutionContext,
} from './types/weather-agent.types';
import {
  extractJsonObject,
  formatLocalDate,
  getFinalAgentMessage,
} from './utils/weather-agent.utils';
import {
  buildApiFailureAnswer,
  buildFailedResponse,
} from './utils/weather-agent-responses';
import { validateWeatherAgentResult } from './utils/weather-agent-validators';
import { WeatherConversationService } from './weather-conversation.service';
import { WeatherModelService } from './weather-model.service';
import { WeatherResponseService } from './weather-response.service';

const WEATHER_AGENT_KEY = 'weather';

type WeatherAnswerChunkHandler = (chunk: string) => void | Promise<void>;

@Injectable()
export class WeatherService {
  constructor(
    private readonly agentPersistence: AgentPersistenceService,
    private readonly conversationService: WeatherConversationService,
    private readonly weatherModelService: WeatherModelService,
    private readonly weatherResponseService: WeatherResponseService,
  ) {}

  /**
   * 返回天气 Agent 运行状态。
   *
   * @returns 天气 Agent 配置状态。
   */
  getStatus(): WeatherAgentStatus {
    return {
      hasApiKey: this.weatherModelService.hasApiKey(),
      integrated: true,
      localTrace: isLangChainLocalTraceEnabled(),
      model: this.weatherModelService.getResponseModelName(),
      provider: 'QWeather',
    };
  }

  /**
   * 生成或复用天气查询会话 ID。
   *
   * @param conversationId 调用方传入的可选会话 ID。
   * @returns 本次请求应使用的会话 ID。
   */
  resolveQueryConversationId(conversationId?: string): string {
    return this.conversationService.resolveConversationId(conversationId);
  }

  /**
   * 查询天气数据并生成面向用户的简洁回答。
   *
   * @param message 自然语言天气请求。
   * @param conversationId 多轮上下文使用的可选会话 ID。
   * @returns 天气数据和生成的回答。
   */
  async query(
    message: string,
    conversationId?: string,
  ): Promise<WeatherAgentResponse> {
    const normalizedQuestion = message.trim();

    if (!normalizedQuestion) {
      throw new BadRequestException('请提供天气查询内容。');
    }

    const activeConversationId =
      this.conversationService.resolveConversationId(conversationId);

    return this.queryByMessage(normalizedQuestion, activeConversationId);
  }

  /**
   * 查询天气并以模型生成片段形式回调最终回答文本。
   *
   * @param message 自然语言天气请求。
   * @param conversationId 多轮上下文使用的可选会话 ID。
   * @param onAnswerChunk 每次收到回答文本片段时触发的回调。
   * @returns 天气数据和完整回答。
   */
  async streamQuery(
    message: string,
    conversationId: string | undefined,
    onAnswerChunk: WeatherAnswerChunkHandler,
  ): Promise<WeatherAgentResponse> {
    const normalizedQuestion = message.trim();

    if (!normalizedQuestion) {
      throw new BadRequestException('请提供天气查询内容。');
    }

    const activeConversationId =
      this.conversationService.resolveConversationId(conversationId);

    return this.queryByMessage(
      normalizedQuestion,
      activeConversationId,
      onAnswerChunk,
    );
  }

  /**
   * 在查询天气数据前解析自然语言天气请求。
   *
   * @param message 用户自然语言请求。
   * @returns 天气 Agent 响应。
   */
  private async queryByMessage(
    message: string,
    conversationId: string,
    onAnswerChunk?: WeatherAnswerChunkHandler,
  ): Promise<WeatherAgentResponse> {
    await this.agentPersistence.ensureConversation({
      agentKey: WEATHER_AGENT_KEY,
      conversationId,
      initialMessage: message,
    });

    const context = await this.buildQueryExecutionContext(
      message,
      conversationId,
      this.weatherModelService.getRequiredOpenAIApiKey(),
    );
    const userMessage = await this.agentPersistence.createMessage({
      content: message,
      conversationId,
      role: AGENT_MESSAGE_ROLE.USER,
    });
    const run = await this.agentPersistence.createRun({
      agentKey: WEATHER_AGENT_KEY,
      conversationId,
      input: {
        agentMessage: context.agentMessage,
        conversationContext: context.conversationContext,
        message,
      },
      model: this.weatherModelService.getResponseModelName(),
      provider: 'QWeather',
      userMessageId: userMessage.id,
    });

    try {
      const agentResult = await this.runWeatherAgent(
        context.agentMessage,
        context.apiKey,
      );

      if (agentResult.action === 'clarify') {
        const response =
          await this.weatherResponseService.handleClarificationResult(
            message,
            context,
            agentResult,
            onAnswerChunk,
          );

        await this.weatherResponseService.persistWeatherResponse(
          response,
          run.id,
        );

        return response;
      }

      if (agentResult.action === 'reuse') {
        const response = await this.weatherResponseService.handleReuseResult(
          message,
          context,
          agentResult,
          onAnswerChunk,
        );

        await this.weatherResponseService.persistWeatherResponse(
          response,
          run.id,
        );

        return response;
      }

      const response = await this.weatherResponseService.handleAnswerResult(
        message,
        context,
        agentResult,
        onAnswerChunk,
      );

      await this.weatherResponseService.persistWeatherResponse(
        response,
        run.id,
      );

      return response;
    } catch (error) {
      const response = buildFailedResponse({
        answer: buildApiFailureAnswer(message, error),
        conversationId,
        message,
        model: this.weatherModelService.getResponseModelName(),
      });

      await this.weatherResponseService.persistWeatherResponse(
        response,
        run.id,
        false,
      );
      await this.agentPersistence.failRun({
        error: this.weatherModelService.serializeError(error),
        runId: run.id,
      });

      return response;
    }
  }

  /**
   * 构建执行天气查询所需的派生上下文。
   *
   * @param message 用户自然语言请求。
   * @param conversationId 多轮上下文使用的可选会话 ID。
   * @param apiKey OpenAI 兼容 API Key。
   * @returns 准备好的查询执行上下文。
   */
  private async buildQueryExecutionContext(
    message: string,
    conversationId: string | undefined,
    apiKey: string,
  ): Promise<WeatherQueryExecutionContext> {
    const normalizedConversationId = conversationId?.trim();
    const conversationContext =
      await this.conversationService.getConversationContext(
        normalizedConversationId,
      );
    const agentMessage = this.conversationService.buildContextualWeatherMessage(
      message,
      conversationContext,
    );
    const originalDemandMessage = this.conversationService.buildDemandMessage(
      message,
      conversationContext,
    );

    return {
      agentMessage,
      apiKey,
      conversationContext,
      normalizedConversationId,
      originalDemandMessage,
    };
  }

  /**
   * 针对自然语言请求运行工具调用型天气 Agent。
   *
   * @param message 自然语言天气请求。
   * @param apiKey OpenAI API Key。
   * @returns 已解析的意图、天气数据和最终回答。
   */
  private async runWeatherAgent(
    message: string,
    apiKey: string,
  ): Promise<WeatherAgentRunResult> {
    const today = formatLocalDate(new Date());
    const agent = createAgent({
      model: this.weatherModelService.createChatModel(apiKey, 0),
      systemPrompt: buildWeatherAgentSystemPrompt(today),
      tools: [cityLookupTool, weatherTool],
    });
    const result = await agent.invoke(
      {
        messages: [
          {
            content: `用户输入：${message}`,
            role: 'user',
          },
        ],
      },
      this.weatherModelService.createWeatherDebugRunConfig(
        'weather.agent.invoke',
        {
          phase: 'intent-and-tool',
        },
      ),
    );
    const output = getFinalAgentMessage(result);

    if (!output) {
      throw new BadRequestException(
        'Weather agent returned an empty response.',
      );
    }

    return validateWeatherAgentResult(JSON.parse(extractJsonObject(output)));
  }
}
