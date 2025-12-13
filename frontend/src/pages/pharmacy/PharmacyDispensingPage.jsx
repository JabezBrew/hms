import { PharmacyQueue } from '@/components/pharmacy';

export default function PharmacyDispensingPage() {
  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Pharmacy Dispensing</h1>
        <p className="text-muted-foreground">
          Review and dispense medications for patient administration
        </p>
      </div>

      <PharmacyQueue />
    </div>
  );
}
