import { PharmacyQueue } from '@/components/pharmacy';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';

/**
 * PharmacyDispensingPage - Chronicle-styled pharmacy dispensing workflow
 *
 * Features:
 * - Review pending medication orders
 * - Dispense medications individually or in bulk
 * - Track overdue medications
 */
export default function PharmacyDispensingPage() {
  return (
    <PageShell>
      <PageHeader
        title="Pharmacy Dispensing"
        description="Review and dispense medications for patient administration"
        contentClassName="max-w-7xl mx-auto w-full"
      />

      {/* Main Content */}
      <main className="px-4 sm:px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <PharmacyQueue />
        </div>
      </main>
    </PageShell>
  );
}
