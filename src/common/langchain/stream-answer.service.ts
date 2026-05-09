import { Injectable } from '@nestjs/common';
import type { StreamAndCollectInput } from './stream-answer.types';

/**
 * 可复用的模型流式输出消费服务。
 */
@Injectable()
export class StreamAnswerService {
  /**
   * 消费模型流并按分片回调，同时聚合完整文本。
   *
   * @param input 流式消费参数。
   * @returns 聚合后的完整文本。
   */
  async streamAndCollect(input: StreamAndCollectInput): Promise<string> {
    const stream = await input.model.stream(input.messages, input.runConfig);
    let answer = '';

    for await (const chunk of stream) {
      const text = input.extractText(chunk.content);

      if (!text) {
        continue;
      }

      answer += text;
      await input.onChunk(text);
    }

    return answer;
  }
}
