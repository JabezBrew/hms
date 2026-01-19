/**
 * DepartmentWardPolicySettings - Admin UI for configuring ward assignment policy.
 *
 * Controls how care team responsibility is assigned when patients are placed in wards.
 * - Flexible: Patient stays with admitting team regardless of bed location
 * - Strict: Patient transfers to ward's owning team when bed is assigned
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { clinicalUnitsApi } from '@/lib/api/organization';
import { organizationKeys } from '@/hooks/useOrganization';
import { cn } from '@/lib/utils';

const POLICY_OPTIONS = [
  {
    value: 'flexible',
    label: 'Flexible',
    description: 'Patient stays with admitting team regardless of bed location',
    icon: Users,
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
  },
  {
    value: 'strict',
    label: 'Strict',
    description: "Patient transfers to ward's owning team when bed is assigned",
    icon: ArrowRightLeft,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
  },
];

/**
 * DepartmentWardPolicySettings component.
 *
 * @param {Object} props
 * @param {string} props.departmentId - Department UUID
 * @param {Object} props.department - Department object with ward_assignment_policy field
 * @param {boolean} props.isLoading - Whether the department data is loading
 * @param {string} props.className - Additional CSS classes
 */
export function DepartmentWardPolicySettings({
  departmentId,
  department,
  isLoading,
  className,
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (policy) =>
      clinicalUnitsApi.patch(departmentId, { ward_assignment_policy: policy }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.unit(departmentId) });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
      toast.success('Ward assignment policy updated');
    },
    onError: (error) => {
      console.error('Failed to update policy:', error);
      toast.error('Failed to update policy');
    },
  });

  const currentPolicy = department?.ward_assignment_policy || 'flexible';
  const currentOption = POLICY_OPTIONS.find((p) => p.value === currentPolicy) || POLICY_OPTIONS[0];

  if (isLoading) {
    return (
      <Card className={cn('border-border', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Ward Assignment Policy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 animate-pulse bg-muted rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('border-border', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-heading">
          <Shield className="h-4 w-4" />
          Ward Assignment Policy
        </CardTitle>
        <CardDescription className="text-sm">
          Controls how care team responsibility is assigned when patients are placed in wards.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label
            htmlFor="ward-policy"
            className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
          >
            Policy
          </Label>
          <Select
            value={currentPolicy}
            onValueChange={(value) => mutation.mutate(value)}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="ward-policy" className="font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POLICY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">
                    <option.icon className={cn('h-4 w-4', option.color)} />
                    <div>
                      <p className="font-medium">{option.label}</p>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Current Policy Explanation */}
        <div
          className={cn(
            'p-4 rounded-lg border',
            currentOption.bgColor,
            'border-border'
          )}
        >
          <div className="flex items-start gap-3">
            <currentOption.icon className={cn('h-5 w-5 mt-0.5', currentOption.color)} />
            <div className="space-y-1">
              <p className="font-medium text-foreground">{currentOption.label} Policy</p>
              <p className="text-sm text-muted-foreground">{currentOption.description}</p>
            </div>
          </div>
        </div>

        {/* Detailed Explanation */}
        <div className="text-sm text-muted-foreground border-l-2 border-border pl-3 space-y-2">
          <p>
            <strong className="text-foreground">Flexible:</strong> Any team can admit patients to
            any ward. The admitting team retains responsibility throughout the stay. Use this when
            teams follow their patients regardless of ward location.
          </p>
          <p>
            <strong className="text-foreground">Strict:</strong> When a patient is placed in a
            ward, responsibility transfers to the team that owns that ward. The original admitting
            team is recorded for audit purposes. Use this for ward-based care models.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Inline version for use within forms.
 */
export function WardPolicyField({ value, onChange, disabled }) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Ward Assignment Policy
      </Label>
      <Select value={value || 'flexible'} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="font-mono">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {POLICY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div className="flex items-center gap-2">
                <option.icon className={cn('h-4 w-4', option.color)} />
                <span>{option.label}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {value === 'strict'
          ? "Patient transfers to ward's team when bed is assigned"
          : 'Patient stays with admitting team regardless of bed'}
      </p>
    </div>
  );
}

export default DepartmentWardPolicySettings;
