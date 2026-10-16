import { lazy, Suspense, useEffect, useState } from 'react';

import {
  buildChronicleWorkspaceProps,
  chronicleWorkspaceLoaders,
} from '@/features/patients/chronicle/workspaceRegistry';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import MobileWorkspaceContextDock from '@/features/patients/components/MobileWorkspaceContextDock';

const chronicleWorkspaceComponents = Object.freeze(
  Object.fromEntries(
    Object.entries(chronicleWorkspaceLoaders).map(([workspaceId, loader]) => [
      workspaceId,
      lazy(loader),
    ]),
  ),
);

const ChronicleWorkspaceHost = ({ activeWorkspace, workspaceContext }) => {
  const [fluidVisited, setFluidVisited] = useState(false);
  useEffect(() => { if (activeWorkspace === 'fluids') setFluidVisited(true); }, [activeWorkspace]);
  // Keep an uncertain fluid command in memory across a normal workspace close.
  // Its own patient/admission/auth boundary still removes stale copied forms.
  const keepFluid = isRustV2ApiMode() && (fluidVisited || activeWorkspace === 'fluids');
  const FluidWorkspace = chronicleWorkspaceComponents.fluids;
  const fluidProps = keepFluid ? buildChronicleWorkspaceProps('fluids', workspaceContext) : null;
  const WorkspaceComponent = activeWorkspace ? chronicleWorkspaceComponents[activeWorkspace] : null;
  const workspaceProps = WorkspaceComponent ? buildChronicleWorkspaceProps(activeWorkspace, workspaceContext) : null;
  if (!keepFluid && !workspaceProps) return null;
  return (
    <Suspense fallback={null}>
      {fluidProps && <FluidWorkspace {...fluidProps} open={activeWorkspace === 'fluids'} />}
      {WorkspaceComponent && workspaceProps && !(keepFluid && activeWorkspace === 'fluids') && <WorkspaceComponent {...workspaceProps} />}
      {activeWorkspace && <MobileWorkspaceContextDock key={activeWorkspace} activeWorkspace={activeWorkspace} context={workspaceContext.mobileContext} />}
    </Suspense>
  );
};

export default ChronicleWorkspaceHost;
