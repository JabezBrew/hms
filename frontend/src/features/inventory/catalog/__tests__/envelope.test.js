import { expect, it } from 'vitest';
import { categoryPage, historyPage, itemPage } from '../model';
import { item, page, revisionId, stamp } from './fixtures';

// Rust's shared ListResponse serializes metadata even when it is empty. These
// controls cross the exact public validators used by all three catalog reads.
it.each([
  ['item directory', itemPage],
  ['category selection', categoryPage],
  ['catalog history', historyPage],
])('accepts the actual standard metadata envelope for %s', (_purpose, validate) => {
  const response = { data: [], page: { limit: 25, has_next: false, next_cursor: null }, meta: {} };
  expect(validate(response)).toBe(response);
});

const legacy = { source: 'legacy_dated_version', id: revisionId, effective_from: '2099-01-01', effective_to: null,
  code: '', name: item.name, unit: item.unit, recorded_at: stamp, reason_present: true };
const purposes = [
  ['item directory', itemPage, item],
  ['category selection', categoryPage, item.category],
  ['catalog history', historyPage, legacy],
];
it.each(purposes)('retains the original %s envelope and opaque metadata without projecting authority', (_purpose, validate, row) => {
  const response = page([row]);
  response.meta = { request: 'synthetic-opaque-metadata' };
  expect(validate(response)).toBe(response);
  expect(response.data[0]).toBe(row);
  expect(response.meta).toEqual({ request: 'synthetic-opaque-metadata' });
});
it.each(purposes)('keeps closed %s root, row and page validation with standard metadata', (_purpose, validate, row) => {
  const valid = page([row]);
  const missing = { ...valid }; delete missing.meta;
  expect(() => validate(missing)).toThrow();
  for (const meta of [null, [], 'invalid metadata', 1, true]) expect(() => validate({ ...valid, meta })).toThrow();
  expect(() => validate({ ...valid, total: 1 })).toThrow();
  expect(() => validate(page([{ ...row, unsupported_field: true }]))).toThrow();
  expect(() => validate({ ...valid, page: { ...valid.page, has_next: true, next_cursor: null } })).toThrow();
});
