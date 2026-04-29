/**
 * 认证白名单配置
 * 配置不需要 JWT 认证的路径
 */
export interface WhitelistConfig {
  /**
   * 精确匹配的路径列表
   */
  exact?: string[];
  /**
   * 路径前缀匹配列表
   */
  prefix?: string[];
  /**
   * 正则表达式匹配列表
   */
  regex?: RegExp[];
}

/**
 * 默认白名单配置
 */
export const DEFAULT_WHITELIST: WhitelistConfig = {
  exact: [
    '/ai-service/user/register',
    '/ai-service/user/login',
    '/ai-service/alipay-auth/login',
    '/ai-service/user/emailLogin',
    '/ai-service/general/captcha',
    '/ai-service/general/upload',
    '/ai-service/general/emailCode',
    '/ai-service/chat/health',
    '/ai-service/video/health',
    '/ai-service/image/health',
    '/ai-service/user/health',
    '/ai-service/alipay-auth/health',
    '/ai-service/general/health',
  ],
  prefix: ['/ai-service/account-manage/', '/ai-service/docx-process/*'],
  regex: [],
};

/**
 * 检查路径是否在白名单中
 *
 * @param path 请求路径。
 * @param config 白名单配置。
 * @returns 是否在白名单内。
 */
export function isWhitelisted(
  path: string,
  config: WhitelistConfig = DEFAULT_WHITELIST,
): boolean {
  const cleanPath = path.split('?')[0];

  if (config.exact?.some((p) => p === cleanPath)) {
    return true;
  }

  if (config.prefix?.some((p) => cleanPath.startsWith(p))) {
    return true;
  }

  if (config.regex?.some((regex) => regex.test(cleanPath))) {
    return true;
  }

  return false;
}
