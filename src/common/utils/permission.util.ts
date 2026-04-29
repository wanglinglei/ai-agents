import { ForbiddenException } from '@nestjs/common';
import { ErrorCode } from '../config/error-code.config';

class ForbiddenExceptionWithCode extends ForbiddenException {
  constructor(
    message: string,
    public readonly errCode: ErrorCode,
  ) {
    super({ message, errCode });
  }
}

const FEATURE_MAP: Record<string, string> = {
  chat: 'chat',
  image: 'image',
  video: 'video',
  'docx-process': 'docx',
  'data-analyse': 'dataAnalyse',
};

/**
 * 从请求路径中提取功能名称。
 *
 * @param path 请求路径。
 * @returns 功能名，不存在时返回 null。
 */
export function extractFeatureFromPath(path: string): string | null {
  const cleanPath = path.split('?')[0];
  const match = cleanPath.match(/\/ai-service\/([^/]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

/**
 * 检查用户是否有权限访问指定功能。
 *
 * @param authScope 用户授权范围。
 * @param feature 功能名称。
 * @param path 请求路径。
 * @returns 是否有权限。
 */
export function hasPermission(
  authScope: string,
  feature: string,
  path: string,
): boolean {
  if (!authScope || !feature) {
    return false;
  }

  const scopes = authScope.split(',').map((s) => s.trim());
  if (path.includes('admin')) {
    return scopes.includes('admin');
  }

  const permissionName = FEATURE_MAP[feature] || feature;
  return scopes.includes(permissionName);
}

/**
 * 验证用户权限，不满足时抛出异常。
 *
 * @param authScope 用户授权范围。
 * @param path 请求路径。
 */
export function validatePermission(authScope: string, path: string): void {
  const feature = extractFeatureFromPath(path);
  if (!feature) {
    return;
  }
  if (feature === 'general' || feature === 'user') {
    return;
  }

  if (!hasPermission(authScope, feature, path)) {
    const featureName = FEATURE_MAP[feature] || feature;
    throw new ForbiddenExceptionWithCode(
      `您没有访问 ${featureName} 功能的权限，请联系管理员`,
      ErrorCode.FEATURE_PERMISSION_DENIED,
    );
  }
}
