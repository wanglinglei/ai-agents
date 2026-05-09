import { BadRequestException, Injectable } from '@nestjs/common';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import {
  getLangChainModelName,
  getOpenAIApiKey,
  getOpenAIBaseUrl,
  hasOpenAIApiKey,
} from '../../common/config/runtime-env.config';
import {
  createLangChainLocalTraceConfig,
  isLangChainLocalTraceEnabled,
} from '../../common/langchain/langchain-local-trace';

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1';

@Injectable()
export class LangchainService {
  /**
   * Returns current LangChain runtime status.
   *
   * @returns Service status for integration checks.
   */
  getStatus(): {
    hasApiKey: boolean;
    integrated: boolean;
    localTrace: boolean;
    model: string;
  } {
    return {
      hasApiKey: hasOpenAIApiKey(),
      integrated: true,
      localTrace: isLangChainLocalTraceEnabled(),
      model: getLangChainModelName(),
    };
  }

  /**
   * Generates text with LangChain and OpenAI chat model.
   *
   * @param prompt User input prompt.
   * @returns Generated model text.
   */
  async invoke(prompt: string): Promise<string> {
    if (!prompt?.trim()) {
      throw new BadRequestException(
        'Query parameter "prompt" cannot be empty.',
      );
    }

    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      throw new BadRequestException(
        'OPENAI_API_KEY is missing. Please set it before invoking LangChain.',
      );
    }

    const chain = ChatPromptTemplate.fromMessages([
      ['system', 'You are a concise and helpful assistant.'],
      ['human', '{input}'],
    ])
      .pipe(
        new ChatOpenAI({
          apiKey,
          model: getLangChainModelName(),
          temperature: 0.2,
          configuration: {
            baseURL: getOpenAIBaseUrl() || DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
          },
        }),
      )
      .pipe(new StringOutputParser());

    return chain.invoke(
      { input: prompt },
      createLangChainLocalTraceConfig({
        metadata: {
          entrypoint: 'LangchainService.invoke',
          model: getLangChainModelName(),
        },
        runName: 'langchain.invoke',
        tags: ['langchain', 'invoke'],
      }),
    );
  }
}
