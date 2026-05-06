import { BadRequestException, Injectable } from '@nestjs/common';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';

@Injectable()
export class LangchainService {
  /**
   * Returns current LangChain runtime status.
   *
   * @returns Service status for integration checks.
   */
  getStatus(): { integrated: boolean; hasApiKey: boolean; model: string } {
    return {
      integrated: true,
      hasApiKey: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
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

    const apiKey = process.env.OPENAI_API_KEY;
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
          model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
          temperature: 0.2,
        }),
      )
      .pipe(new StringOutputParser());

    return chain.invoke({ input: prompt });
  }
}
