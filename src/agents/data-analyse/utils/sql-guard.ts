import { BadRequestException } from '@nestjs/common';

const FORBIDDEN_SQL_PATTERN =
  /\b(insert|update|delete|alter|drop|truncate|create|grant|revoke|merge|replace|call|execute)\b/i;

/**
 * 校验并标准化只读 SQL，必要时补充或覆盖 LIMIT。
 *
 * @param sql 原始 SQL。
 * @param maxLimit 最大允许返回行数。
 * @returns 可安全执行的 SQL。
 */
export function ensureReadonlySelectSql(sql: string, maxLimit = 200): string {
  const normalizedSql = sql.trim().replace(/;+\s*$/g, '');

  if (!normalizedSql) {
    throw new BadRequestException('生成 SQL 为空，无法执行查询。');
  }

  if (normalizedSql.includes('--') || normalizedSql.includes('/*')) {
    throw new BadRequestException('SQL 包含注释，已拒绝执行。');
  }

  if (FORBIDDEN_SQL_PATTERN.test(normalizedSql)) {
    throw new BadRequestException('仅允许执行只读 SELECT 查询。');
  }

  if (normalizedSql.includes(';')) {
    throw new BadRequestException('仅允许执行单条 SQL。');
  }

  if (!/^\s*(select|with)\b/i.test(normalizedSql)) {
    throw new BadRequestException('仅允许 SELECT/CTE 查询。');
  }

  const limitMatch = normalizedSql.match(/\blimit\s+(\d+)\b/i);

  if (!limitMatch) {
    return `${normalizedSql} LIMIT ${maxLimit}`;
  }

  const currentLimit = Number(limitMatch[1]);

  if (Number.isNaN(currentLimit) || currentLimit <= 0) {
    return normalizedSql.replace(/\blimit\s+\d+\b/i, `LIMIT ${maxLimit}`);
  }

  if (currentLimit > maxLimit) {
    return normalizedSql.replace(/\blimit\s+\d+\b/i, `LIMIT ${maxLimit}`);
  }

  return normalizedSql;
}
