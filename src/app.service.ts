import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * Returns default welcome text.
   *
   * @returns Hello world string.
   */
  getHello(): string {
    return 'Hello World!';
  }
}
