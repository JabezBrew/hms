import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

function createRustV2WorkflowUnsupportedError(workflowName = 'Workflow') {
  return new Error(
    `${workflowName} is unavailable in Rust V2 mode: no generated /api/v2 workflow contract exists.`,
  );
}

export function ensureRustV2WorkflowSupported(workflowName) {
  if (isRustV2ApiMode()) {
    throw createRustV2WorkflowUnsupportedError(workflowName);
  }
}
