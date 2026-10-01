import type { ProxyConfig } from '../types';

/** 代理约定：`<proxy>/__proxy/<host>/<path>`，与 tools/cors-proxy.mjs 保持一致。 */
export const PROXY_PREFIX = '/__proxy/';

/**
 * 把目标地址改写成走本机代理的形式。
 * 关掉代理、或地址不完整时原样返回，调用方不需要分支。
 */
export function withProxy(proxy: ProxyConfig, targetUrl: string): string {
  if (!proxy.enabled) return targetUrl;

  const base = proxy.url.trim().replace(/\/+$/, '');
  const stripped = targetUrl
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^\/+/, '');
  if (!base || !stripped) return targetUrl;

  return `${base}${PROXY_PREFIX}${stripped}`;
}

/** 展示用：实际请求会打到哪里。 */
export function describeTarget(proxy: ProxyConfig, targetUrl: string): string {
  return withProxy(proxy, targetUrl);
}
