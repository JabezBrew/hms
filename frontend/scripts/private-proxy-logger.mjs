import { createLogger } from 'vite';

// Vite includes req.url and the upstream stack in default proxy errors. Clinical
// identifiers and free-text query parameters must never reach terminal logs.
export function createPrivateProxyLogger(logger = createLogger()) {
  const originalError = logger.error.bind(logger);
  logger.error = (message, options) => {
    if (typeof message === 'string' && /(?:http|ws) proxy (?:(?:socket|bypass) )?error:/.test(message)) {
      originalError('HMS proxy request failed. Check the configured backend connection.', {
        timestamp: true,
      });
      return;
    }
    originalError(message, options);
  };
  return logger;
}
