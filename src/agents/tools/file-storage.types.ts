/**
 * 通用文件存储工具输入参数。
 */
export interface FileStorageInput {
  /** 文件内容文本；`encoding=base64` 时应传 Base64 字符串。 */
  content: string;
  /** 上传对象的 MIME 类型；未传时使用 `application/octet-stream`。 */
  contentType?: string;
  /** 内容编码方式；默认按 `utf-8` 处理。 */
  encoding?: BufferEncoding | 'base64';
  /** 对象文件名；未传时自动生成时间戳文件名。 */
  fileName?: string;
}

/**
 * 通用文件存储工具返回结果。
 */
export interface FileStorageResult {
  /** 对象存储 bucket 名称。 */
  bucket: string;
  /** 实际上传时使用的文件名。 */
  fileName: string;
  /** 对象存储 key。 */
  key: string;
  /** 对外可访问的公共 URL。 */
  publicUrl: string;
  /** 原始字节大小（Byte）。 */
  size: number;
}
