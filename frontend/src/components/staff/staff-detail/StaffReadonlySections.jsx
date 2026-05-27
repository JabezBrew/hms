import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import History from 'lucide-react/dist/esm/icons/history.js';

import StaffActivityLog from '../StaffActivityLog';
import { StaffWardAssignments } from '../StaffWardAssignments';

export function StaffReadonlySections({ staff, view }) {
  return (
    <>
      {view.isPractitioner && view.practitionerId ? (
        <section>
          <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
            <Building2 className="size-5 text-muted-foreground" />
            Ward Assignments
          </h2>
          <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
            <StaffWardAssignments
              practitionerId={view.practitionerId}
              practitionerName={view.fullName}
            />
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
          <History className="size-5 text-muted-foreground" />
          Activity Log
        </h2>
        <StaffActivityLog userId={staff.user_details?.id} userName={view.fullName} />
      </section>
    </>
  );
}
