import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { staffFieldToStep } from '../staffForm.utils';

export function StaffValidationAlert({ errors, onGoToStep, onGoToFirstErrorStep }) {
  if (!Object.keys(errors || {}).length) return null;

  return (
    <Alert className="mb-6 border-amber-200 bg-amber-50/60 text-amber-950 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-100">
      <AlertCircle />
      <AlertTitle>Fix a few items to continue</AlertTitle>
      <AlertDescription>
        <div className="space-y-1">
          {Object.entries(errors).map(([field, err]) => {
            const targetStep = staffFieldToStep[field];
            return (
              <button
                key={field}
                type="button"
                className="text-left hover:underline font-mono text-xs"
                onClick={() => {
                  if (targetStep) {
                    onGoToStep(targetStep, field);
                  } else {
                    onGoToFirstErrorStep();
                  }
                }}
              >
                {String(err?.message || field)}
              </button>
            );
          })}
        </div>
      </AlertDescription>
    </Alert>
  );
}
