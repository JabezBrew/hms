import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, UserPlus, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useWardRoundWorkflow,
  useAdmissionWorkflow,
  useDischargeWorkflow,
} from '@/hooks/useWorkflowQueries';

/**
 * WorkflowLauncher - Component to start clinical workflows
 *
 * @param {Object} props
 * @param {Object} props.patient - Patient data (required for ward-round and discharge)
 * @param {Object} props.admission - Admission data (required for ward-round and discharge)
 * @param {string} props.workflowType - Specific workflow type: 'ward-round', 'admission', 'discharge'
 * @param {string} props.variant - Button variant (default: 'default')
 * @param {string} props.size - Button size (default: 'default')
 * @param {Function} props.onWorkflowStart - Callback when workflow starts with workflow data
 * @param {ReactNode} props.trigger - Custom trigger element
 * @param {string} props.className - Additional CSS classes
 */
export default function WorkflowLauncher({
  patient,
  admission,
  workflowType,
  variant = 'default',
  size = 'default',
  onWorkflowStart,
  trigger,
  className,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState(workflowType || '');

  const { startWardRound } = useWardRoundWorkflow();
  const { startAdmission } = useAdmissionWorkflow();
  const { startDischarge } = useDischargeWorkflow();

  const workflows = [
    {
      type: 'ward-round',
      name: 'Ward Round',
      description: 'Daily patient review with vitals, assessment, and plan',
      icon: Stethoscope,
      color: 'amber',
      requiresAdmission: true,
    },
    {
      type: 'admission',
      name: 'Patient Admission',
      description: 'Complete admission workflow with history, examination, and orders',
      icon: UserPlus,
      color: 'emerald',
      requiresAdmission: false,
    },
    {
      type: 'discharge',
      name: 'Patient Discharge',
      description: 'Discharge process with summary, medications, and follow-up',
      icon: UserCheck,
      color: 'sky',
      requiresAdmission: true,
    },
  ];

  const selectedWorkflowConfig = workflows.find((w) => w.type === selectedWorkflow);

  const handleStartWorkflow = async () => {
    if (!selectedWorkflow) {
      return;
    }

    try {
      let result;

      switch (selectedWorkflow) {
        case 'ward-round':
          if (!patient?.id || !admission?.id) {
            throw new Error('Patient and admission required for ward round');
          }
          result = await startWardRound.mutateAsync({
            patientId: patient.id,
            admissionId: admission.id,
          });
          break;

        case 'admission':
          if (!patient?.id) {
            throw new Error('Patient required for admission');
          }
          result = await startAdmission.mutateAsync({
            patientId: patient.id,
          });
          break;

        case 'discharge':
          if (!patient?.id || !admission?.id) {
            throw new Error('Patient and admission required for discharge');
          }
          result = await startDischarge.mutateAsync({
            patientId: patient.id,
            admissionId: admission.id,
          });
          break;

        default:
          throw new Error('Invalid workflow type');
      }

      setIsOpen(false);
      onWorkflowStart?.(result);
    } catch (error) {
      console.error('Failed to start workflow:', error);
    }
  };

  // If specific workflow type provided, show direct button
  if (workflowType) {
    const config = workflows.find((w) => w.type === workflowType);
    const Icon = config.icon;

    return (
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={handleStartWorkflow}
        disabled={
          startWardRound.isPending ||
          startAdmission.isPending ||
          startDischarge.isPending
        }
      >
        <Icon className="h-4 w-4 mr-2" />
        Start {config.name}
      </Button>
    );
  }

  // Otherwise show workflow selection dialog
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant={variant} size={size} className={className}>
            <Stethoscope className="h-4 w-4 mr-2" />
            Start Workflow
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Start Clinical Workflow
          </DialogTitle>
          <DialogDescription>
            {patient ? (
              <>
                Select a workflow for{' '}
                <span className="font-display text-foreground">{patient.full_name}</span>
              </>
            ) : (
              'Select a workflow to begin'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Workflow selection */}
          <div className="space-y-3">
            {workflows.map((workflow) => {
              const Icon = workflow.icon;
              const disabled = workflow.requiresAdmission && !admission;

              return (
                <button
                  key={workflow.type}
                  className={cn(
                    'w-full text-left p-4 rounded-xl border transition-all',
                    selectedWorkflow === workflow.type
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50',
                    disabled && 'opacity-50 cursor-not-allowed'
                  )}
                  onClick={() => !disabled && setSelectedWorkflow(workflow.type)}
                  disabled={disabled}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'p-2 rounded-lg mt-1',
                        `bg-${workflow.color}-500/10 border border-${workflow.color}-500/20`
                      )}
                    >
                      <Icon className={cn('h-5 w-5', `text-${workflow.color}-400`)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-heading text-base font-semibold">
                          {workflow.name}
                        </h4>
                        {disabled && (
                          <Badge variant="outline" className="text-[10px]">
                            Requires Admission
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {workflow.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Start button */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleStartWorkflow}
              disabled={
                !selectedWorkflow ||
                startWardRound.isPending ||
                startAdmission.isPending ||
                startDischarge.isPending
              }
            >
              {selectedWorkflowConfig && (
                <selectedWorkflowConfig.icon className="h-4 w-4 mr-2" />
              )}
              {startWardRound.isPending ||
              startAdmission.isPending ||
              startDischarge.isPending
                ? 'Starting...'
                : `Start ${selectedWorkflowConfig?.name || 'Workflow'}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
