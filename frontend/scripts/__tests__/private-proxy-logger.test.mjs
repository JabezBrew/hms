import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { test } from 'node:test';
import { createPrivateProxyLogger } from '../private-proxy-logger.mjs';

function captureLogger() {
  const errors = [];
  return {
    errors,
    info() {}, warn() {}, warnOnce() {}, clearScreen() {},
    hasErrorLogged() { return false; },
    hasWarned: false,
    error(message, options) { errors.push({ message, options }); },
  };
}

test('real Vite proxy failure excludes clinical path, query and upstream error object', async () => {
  const capture = captureLogger();
  const server = await createServer({
    configFile: false,
    customLogger: createPrivateProxyLogger(capture),
    server: { host: '127.0.0.1', port: 0, proxy: {
      '/api/v2': { target: 'http://127.0.0.1:9', changeOrigin: true },
    } },
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    const sentinel = 'SYNTHETIC-PRIVATE-REQUEST-SENTINEL';
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/patients/${sentinel}?note=${sentinel}`, {
      headers: { Authorization: 'Bearer ' + sentinel },
    });
    assert.equal(response.status, 500);
    assert.ok(capture.errors.length > 0);
    assert.match(capture.errors[0].message, /HMS proxy request failed/);
    assert.ok(!JSON.stringify(capture.errors).includes(sentinel));
    assert.ok(!JSON.stringify(capture.errors).includes('127.0.0.1:9'));
    assert.equal(capture.errors[0].options.error, undefined);
  } finally {
    await server.close();
  }
});

test('all installed proxy diagnostic variants hide stacks while compiler diagnostics survive', () => {
  const capture = captureLogger();
  const logger = createPrivateProxyLogger(capture);
  for (const diagnostic of ['http proxy error:', 'ws proxy error:', 'ws proxy socket error:', 'ws proxy bypass error:']) {
    logger.error(diagnostic + '\nSYNTHETIC-PRIVATE-STACK', { error: new Error('SYNTHETIC-PRIVATE-STACK') });
  }
  const compiler = { timestamp: true };
  logger.error('A source module failed to compile.', compiler);
  assert.ok(!JSON.stringify(capture.errors.slice(0, 4)).includes('SYNTHETIC-PRIVATE-STACK'));
  assert.equal(capture.errors[4].message, 'A source module failed to compile.');
  assert.equal(capture.errors[4].options, compiler);
});
