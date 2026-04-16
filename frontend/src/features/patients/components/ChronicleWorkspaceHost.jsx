import { lazy, Suspense } from 'react';

import { WorkspaceDisplayProvider } from '@/contexts/WorkspaceDisplayContext';
import {
  buildChronicleWorkspaceProps,
  chronicleWorkspaceLoaders,
} from '@/features/patients/chronicle/workspaceRegistry';
import WorkspaceLaunchpad from './WorkspaceLaunchpad';

const chronicleWorkspaceComponents = Object.freeze(
  Object.fromEntries(
    Object.entries(chronicleWorkspaceLoaders).map(([workspaceId, loader]) => [
      workspaceId,
      lazy(loader),
    ]),
  ),
);

const ChronicleWorkspaceHost = ({ activeWorkspace, workspaceContext, variant = 'overlay' }) => {
  const isInline = variant === 'inline';
  const launchpad = isInline ? <WorkspaceLaunchpad workspaceContext={workspaceContext} /> : null;

  const WorkspaceComponent = activeWorkspace
    ? chronicleWorkspaceComponents[activeWorkspace]
    : null;
  const workspaceProps = WorkspaceComponent
    ? buildChronicleWorkspaceProps(activeWorkspace, workspaceContext)
    : null;

  const content =
    WorkspaceComponent && workspaceProps ? (
      <Suspense fallback={launchpad}>
        <WorkspaceComponent {...workspaceProps} />
      </Suspense>
    ) : (
      launchpad
    );

  return (
    <WorkspaceDisplayProvider variant={variant}>
      {content}
    </WorkspaceDisplayProvider>
  );
};

export default ChronicleWorkspaceHost;
