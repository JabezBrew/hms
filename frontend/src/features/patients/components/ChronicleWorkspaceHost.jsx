import { lazy, Suspense, useEffect, useState } from 'react';
import { buildChronicleWorkspaceProps, canMountChronicleWorkspace, chronicleWorkspaceLoaders } from '@/features/patients/chronicle/workspaceRegistry';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import MobileWorkspaceContextDock from '@/features/patients/components/MobileWorkspaceContextDock';

const chronicleWorkspaceComponents = Object.freeze(Object.fromEntries(
  Object.entries(chronicleWorkspaceLoaders).map(([id, loader]) => [id, lazy(loader)]),
));
const retainedIds = ['fluids', 'handover', 'note', 'noteTemplatePreview', 'admissionAdvisory', 'admissionMove', 'medicationCourses', 'referralResponse'];
function useRetainedClinicalWorkspaces(activeWorkspace, context) {
  const [visited, setVisited] = useState([]);
  const active = isRustV2ApiMode() && retainedIds.includes(activeWorkspace)
    && canMountChronicleWorkspace(activeWorkspace, context) ? activeWorkspace : null;
  // A first authorized visit loads the panel; ordinary close keeps only its
  // controller. Revoked proof unmounts it immediately. No form loads before visit.
  useEffect(() => {
    if (active) setVisited((old) => old.includes(active) ? old : [...old, active]);
  }, [active]);
  return retainedIds.filter((id) => isRustV2ApiMode() && canMountChronicleWorkspace(id, context)
    && (visited.includes(id) || active === id));
}
function RetainedWorkspace({ id, activeWorkspace, context }) {
  const Component = chronicleWorkspaceComponents[id];
  const props = buildChronicleWorkspaceProps(id, context);
  return props ? <Component {...props} open={activeWorkspace === id} /> : null;
}
function DeniedWorkspace({ onClose }) {
  return <Dialog open onOpenChange={(next) => { if (!next) onClose?.(); }}>
    <DialogContent><DialogHeader><DialogTitle>Clinical workspace unavailable</DialogTitle><DialogDescription>Current patient clinical access and permission for this action could not be confirmed. Close this panel and refresh your access.</DialogDescription></DialogHeader><Button variant="outline" onClick={onClose}>Close</Button></DialogContent>
  </Dialog>;
}
const ChronicleWorkspaceHost = ({ activeWorkspace, workspaceContext }) => {
  const retained = useRetainedClinicalWorkspaces(activeWorkspace, workspaceContext);
  const denied = activeWorkspace && !canMountChronicleWorkspace(activeWorkspace, workspaceContext);
  const active = !denied && !retained.includes(activeWorkspace) ? activeWorkspace : null;
  const Component = chronicleWorkspaceComponents[active];
  const props = Component ? buildChronicleWorkspaceProps(active, workspaceContext) : null;
  if (!denied && !retained.length && !props) return null;
  return <Suspense fallback={null}>
    {denied && <DeniedWorkspace onClose={workspaceContext.onClose} />}
    {retained.map((id) => <RetainedWorkspace key={id === 'admissionMove' ? id : `${id}:${workspaceContext.selectedWardId || ''}`} id={id} activeWorkspace={activeWorkspace} context={workspaceContext} />)}
    {Component && props && <Component {...props} />}
    {activeWorkspace && !denied && <MobileWorkspaceContextDock key={activeWorkspace} activeWorkspace={activeWorkspace} context={workspaceContext.mobileContext} />}
  </Suspense>;
};
export default ChronicleWorkspaceHost;
