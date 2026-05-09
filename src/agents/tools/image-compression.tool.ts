/*
 * @Author: wanglinglei
 * @Date: 2026-04-29 17:07:28
 * @Description: 图片压缩工具
 * @FilePath: /agents/src/agents/tools/image-compression.tool.ts
 * @LastEditTime: 2026-04-29 17:25:18
 */
import { DynamicTool } from '@langchain/core/tools';
import tinify from 'tinify';
import { getTinifyApiKey as getTinifyApiKeyFromConfig } from '../../common/config/runtime-env.config';

export interface ImageCompressionResult {
  base64: string;
  compressedBytes: number;
  sourceUrl: string;
}

/**
 * Ensures the Tinify API key is configured before calling the API.
 *
 * @returns Tinify API key from environment variables.
 */
function getTinifyApiKey(): string {
  const apiKey = getTinifyApiKeyFromConfig();

  if (!apiKey) {
    throw new Error('TINIFY_API_KEY or TINYPNG_API_KEY is required.');
  }

  return apiKey;
}

/**
 * Configures Tinify with the current API key.
 */
function configureTinify(): void {
  tinify.key = getTinifyApiKey();
}

/**
 * Parses a tool input string into an image URL.
 *
 * @param input Raw URL or JSON string containing a url field.
 * @returns Image URL to compress.
 */
function parseImageUrl(input: string): string {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    throw new Error('Image URL cannot be empty.');
  }

  if (!trimmedInput.startsWith('{')) {
    return trimmedInput;
  }

  const parsedInput = JSON.parse(trimmedInput) as { url?: unknown };

  if (typeof parsedInput.url !== 'string' || !parsedInput.url.trim()) {
    throw new Error('JSON input must include a non-empty "url" string.');
  }

  return parsedInput.url.trim();
}

/**
 * Compresses an image buffer and returns the compressed buffer.
 *
 * @param buffer Image buffer to compress.
 * @returns Compressed image buffer.
 */
export async function compressBuffer(buffer: Buffer): Promise<Buffer> {
  configureTinify();

  const source = tinify.fromBuffer(buffer);
  const result = await source.toBuffer();

  return Buffer.from(result);
}

/**
 * Compresses an image from a URL and returns the compressed buffer.
 *
 * @param url Image URL to compress.
 * @returns Compressed image buffer.
 */
export async function compressUrl(url: string): Promise<Buffer> {
  configureTinify();

  const source = tinify.fromUrl(url);
  const result = await source.toBuffer();

  return Buffer.from(result);
}

/**
 * Compresses an image from a URL and returns a JSON-safe result.
 *
 * @param url Image URL to compress.
 * @returns Compression result with base64 payload.
 */
export async function compressImageUrl(
  url: string,
): Promise<ImageCompressionResult> {
  const compressedBuffer = await compressUrl(url);

  return {
    base64: compressedBuffer.toString('base64'),
    compressedBytes: compressedBuffer.byteLength,
    sourceUrl: url,
  };
}

/**
 * LangChain tool for compressing an image from a URL with Tinify.
 */
export const imageCompressionTool = new DynamicTool({
  name: 'image_compression',
  description:
    'Compress an image from a URL using Tinify. Input can be a raw image URL or JSON like {"url":"https://example.com/image.png"}. Returns JSON with base64, compressedBytes, and sourceUrl.',
  func: async (input: string): Promise<string> =>
    JSON.stringify(await compressImageUrl(parseImageUrl(input))),
});
