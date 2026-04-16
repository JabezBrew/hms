import { lazy, Suspense } from 'react';

import {
  buildChronicleWorkspaceProps,
  chronicleWorkspaceLoaders,
} from '@/features/patients/chronicle/workspaceRegistry';

const chronicleWorkspaceComponents = Object.freeze(
  Object.fromEntries(
    Object.entries(chronicleWorkspaceLoaders).map(([workspaceId, loader]) => [
      workspaceId,
      lazy(loader),
    ]),
  ),
);

const ChronicleWorkspaceHost = ({ activeWorkspace, workspaceContext }) => {
  if (!activeWorkspace) {
    return null;
  }

  const WorkspaceComponent = chronicleWorkspaceComponents[activeWorkspace];
  if (!WorkspaceComponent) {
    return null;
  }

  const workspaceProps = buildChronicleWorkspaceProps(activeWorkspace, workspaceContext);
  if (!workspaceProps) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <WorkspaceComponent {...workspaceProps} />
    </Suspense>
  );
};

export default ChronicleWorkspaceHost;
