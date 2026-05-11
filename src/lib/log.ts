/**
 * Tiny prefixed console logger. Every line the bridge emits goes
 * through here so operators grep `[dm-assistant-bridge]` to find
 * our log lines among Foundry's own and other modules'.
 */

const PREFIX = "[dm-assistant-bridge]";

export const log = {
  debug: (...args: unknown[]): void => console.debug(PREFIX, ...args),
  info:  (...args: unknown[]): void => console.info(PREFIX, ...args),
  warn:  (...args: unknown[]): void => console.warn(PREFIX, ...args),
  error: (...args: unknown[]): void => console.error(PREFIX, ...args),
};
