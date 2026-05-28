import { LoadingSpinner } from '@/components/ui/loading-spinner'

export default function PublicAuthLoader() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background px-5 py-10"
      role="status"
      aria-live="polite"
      aria-label="Loading Hospital Management System"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <LoadingSpinner className="h-10 w-24 sm:h-12 sm:w-28" aria-hidden="true" />
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Hospital Management System
        </p>
      </div>
    </div>
  )
}
