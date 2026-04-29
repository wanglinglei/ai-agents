/**
 * 错误码常量配置
 * 用于前端统一处理异常场景
 * 仅包含认证相关和权限相关的错误码
 */
export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_DISABLED = 'USER_DISABLED',
  FORBIDDEN = 'FORBIDDEN',
  FEATURE_PERMISSION_DENIED = 'FEATURE_PERMISSION_DENIED',
}

/**
 * 错误码与 HTTP 状态码的映射关系
 */
export const ERROR_CODE_STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.TOKEN_INVALID]: 401,
  [ErrorCode.USER_NOT_FOUND]: 401,
  [ErrorCode.USER_DISABLED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.FEATURE_PERMISSION_DENIED]: 403,
};
