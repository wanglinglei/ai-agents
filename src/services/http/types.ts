import { ErrorCode } from '../../common/config/error-code.config';

export interface BaseRequestParams {
  method: 'POST' | 'GET';
  api: string;
  contentType?: string;
  body: Record<string, any>;
  dashScopeAsync?: string;
}

export interface ServiceNameConfig {
  label: string;
  value: string;
}

export interface ConfigServiceNameConfig {
  [feature: string]: ServiceNameConfig[];
}

export interface FeatureServiceConfig {
  [feature: string]: string[];
}

export interface ServiceDefinition<TParams = any, TResponse = any> {
  name: string;
  execute: (params: TParams) => Promise<TResponse>;
  validate?: (params: TParams) => boolean;
}

export interface UnifiedResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errCode?: ErrorCode;
  code?: number;
  serviceName?: string;
  feature?: string;
}

export interface ServiceExecuteOptions {
  fallbackServices?: string[];
  timeout?: number;
  retryCount?: number;
}
