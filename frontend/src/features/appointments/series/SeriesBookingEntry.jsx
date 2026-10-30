import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { userHasCapability } from '@/shared/lib/access';
import { Button } from '@/components/ui/button';
import { scopeIdentity } from './model';
import { SeriesBookingDialog } from './SeriesBookingDialog';
function Entry({ context, serviceAvailable }) {
  const [open, setOpen] = useState(false), [opened, setOpened] = useState(false);
  return <><Button type="button" variant="outline" disabled={!serviceAvailable && !opened} onClick={() => { setOpened(true); setOpen(true); }}>{!serviceAvailable && opened ? 'Review existing booking request' : 'Several appointments'}</Button><SeriesBookingDialog canBook={serviceAvailable} open={open} onClose={() => setOpen(false)} context={context} /></>;
}
export function SeriesBookingEntry({ context, disabled, serviceAvailable }) {
  const { user } = useAuth();
  if (!isRustV2ApiMode() || disabled || !user?.id || !user.facilityCode || !user.accessContext?.facility_id || !user.accessContext?.active_profile || !userHasCapability(user, 'appointment.manage') || !context.patientId || !context.clinicId || !context.serviceId) return null;
  return <Entry key={JSON.stringify([scopeIdentity(user), context.patientId, context.clinicId, context.serviceId, context.practitionerId])} context={context} serviceAvailable={serviceAvailable === true} />;
}
