import { PharmacyQueue } from '@/components/pharmacy';

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
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight mb-1">
            Pharmacy Dispensing
          </h1>
          <p className="text-sm text-muted-foreground">
            Review and dispense medications for patient administration
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="px-4 sm:px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <PharmacyQueue />
        </div>
      </main>
    </div>
  );
}
