/*
 * @Author: wanglinglei
 * @Date: 2026-04-29 17:01:36
 * @Description: 当前时间工具
 * @FilePath: /agents/src/agents/tools/current-time.tool.ts
 * @LastEditTime: 2026-04-29 17:25:46
 */
import { DynamicTool } from '@langchain/core/tools';

export interface CurrentTimeResult {
  iso: string;
  locale: string;
  season: string;
  timestamp: number;
  timezone: string;
}

/**
 * Gets the season name for a zero-based month.
 *
 * @param month Zero-based month from Date#getMonth.
 * @returns Season name in Chinese.
 */
function getSeason(month: number): string {
  if (month >= 2 && month <= 4) {
    return '春季';
  }

  if (month >= 5 && month <= 7) {
    return '夏季';
  }

  if (month >= 8 && month <= 10) {
    return '秋季';
  }

  return '冬季';
}

/**
 * Gets the current server time in multiple common formats.
 *
 * @returns Current server time details.
 */
export function getCurrentTime(): CurrentTimeResult {
  const now = new Date();

  return {
    iso: now.toISOString(),
    locale: now.toLocaleString('zh-CN', {
      hour12: false,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    season: getSeason(now.getMonth()),
    timestamp: now.getTime(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * LangChain tool for retrieving the current server time.
 */
export const currentTimeTool = new DynamicTool({
  name: 'current_time',
  description:
    'Get the current server time. Returns ISO time, zh-CN locale time, season, Unix timestamp in milliseconds, and timezone.',
  func: (): Promise<string> =>
    Promise.resolve(JSON.stringify(getCurrentTime())),
});
