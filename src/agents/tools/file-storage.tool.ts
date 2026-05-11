import { DynamicTool } from '@langchain/core/tools';
import { BitifulService } from '../../lib/bitifulService';
import type { FileStorageInput, FileStorageResult } from './file-storage.types';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

const bitifulService = new BitifulService();

/**
 * Parses tool input into a structured file upload payload.
 *
 * @param input Raw JSON string from tool call.
 * @returns Parsed upload payload.
 */
function parseFileStorageInput(input: string): FileStorageInput {
  const parsed = JSON.parse(input) as FileStorageInput;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Input must be a JSON object.');
  }
  if (typeof parsed.content !== 'string') {
    throw new Error(
      'Input must include string content. Example: {"content":"hello world","fileName":"demo.txt"}',
    );
  }
  return parsed;
}

/**
 * Builds file name for object storage with a deterministic fallback.
 *
 * @param input Upload payload.
 * @returns File name.
 */
function buildFileName(input: FileStorageInput): string {
  const rawFileName = input.fileName?.trim();
  return rawFileName || `file-${Date.now()}`;
}

/**
 * Uploads generic file content to Bitiful object storage.
 *
 * @param input Upload payload.
 * @returns Storage metadata.
 */
export async function uploadFileToBitiful(
  input: FileStorageInput,
): Promise<FileStorageResult> {
  const fileName = buildFileName(input);
  const encoding = input.encoding === 'base64' ? 'base64' : 'utf-8';
  const buffer = Buffer.from(input.content, encoding);

  const uploadResult = await bitifulService.uploadBuffer({
    buffer,
    contentType: input.contentType || DEFAULT_CONTENT_TYPE,
    fileName,
  });

  return {
    bucket: uploadResult.bucket,
    fileName,
    key: uploadResult.key,
    publicUrl: uploadResult.publicUrl,
    size: buffer.byteLength,
  };
}

/**
 * LangChain tool for uploading generic files to Bitiful object storage.
 */
export const fileStorageTool = new DynamicTool({
  name: 'file_storage_upload',
  description:
    'Upload generic content to Bitiful object storage. Input JSON: {"content":"hello world","fileName":"demo.txt","contentType":"text/plain; charset=utf-8","encoding":"utf-8"}. Returns storage key and public URL.',
  func: async (input: string): Promise<string> => {
    const parsed = parseFileStorageInput(input);
    return JSON.stringify(await uploadFileToBitiful(parsed));
  },
});
