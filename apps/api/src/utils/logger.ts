export function createLogger(module: string) {
  return {
    info: (msg: string, ctx?: Record<string, unknown>) => console.info(`[${module}]`, msg, ctx ?? ''),
    warn: (msg: string, ctx?: Record<string, unknown>) => console.warn(`[${module}]`, msg, ctx ?? ''),
    error: (msg: string, ctx?: Record<string, unknown>) => console.error(`[${module}]`, msg, ctx ?? ''),
  };
}
