import { Controller, Get, Query } from '@nestjs/common';
import { LangchainService } from './langchain.service';

@Controller('langchain')
export class LangchainController {
  constructor(private readonly langchainService: LangchainService) {}

  /**
   * Returns integration status for quick checks.
   *
   * @returns LangChain configuration status.
   */
  @Get('status')
  getStatus(): {
    hasApiKey: boolean;
    integrated: boolean;
    localTrace: boolean;
    model: string;
  } {
    return this.langchainService.getStatus();
  }

  /**
   * Invokes a LangChain chain with a prompt.
   *
   * @param prompt User prompt from query string.
   * @returns Model output payload.
   */
  @Get('invoke')
  async invoke(
    @Query('prompt')
    prompt = 'Please introduce NestJS + LangChain integration briefly.',
  ): Promise<{ prompt: string; output: string }> {
    const output = await this.langchainService.invoke(prompt);
    return { prompt, output };
  }
}
