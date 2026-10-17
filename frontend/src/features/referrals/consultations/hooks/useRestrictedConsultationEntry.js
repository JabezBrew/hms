import { useLayoutEffect, useState } from 'react';
import { validId } from '../model';

// Keep one controller across the denied-to-authorized Chronicle transition.
// Closing only hides it; patient/account authority changes remount Chronicle.
export function useRestrictedConsultationEntry({ accessDenied, rustV2Mode, activeWorkspace, workspaceOptions }) {
  const [retained, setRetained] = useState(false);
  const requested = rustV2Mode && accessDenied && activeWorkspace === 'consultation'
    && workspaceOptions?.explicitConsultationEntry === true && validId(workspaceOptions.referralId);
  useLayoutEffect(() => { if (requested) setRetained(true); }, [requested]);
  return retained || requested;
}
