import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js';
import Check from 'lucide-react/dist/esm/icons/check.js';

import { cn } from '@/lib/utils';
import { useChangePassword } from '@/hooks/useSettingsQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Validation schema
const passwordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

/**
 * ChangePasswordForm - Chronicle-styled password change form
 */
export default function ChangePasswordForm() {
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const changePassword = useChangePassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const newPassword = watch('newPassword');

  // Password strength indicators
  const passwordChecks = [
    { label: 'At least 8 characters', met: newPassword?.length >= 8 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(newPassword || '') },
    { label: 'One lowercase letter', met: /[a-z]/.test(newPassword || '') },
    { label: 'One number', met: /[0-9]/.test(newPassword || '') },
  ];

  const onSubmit = async (data) => {
    try {
      await changePassword.mutateAsync({
        oldPassword: data.oldPassword,
        newPassword: data.newPassword,
      });
      toast.success('Password changed successfully');
      reset();
    } catch (error) {
      toast.error(error.message || 'Failed to change password');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Current Password */}
      <div className="space-y-2">
        <Label htmlFor="oldPassword" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Current Password
        </Label>
        <div className="relative">
          <Input
            id="oldPassword"
            type={showOldPassword ? 'text' : 'password'}
            {...register('oldPassword')}
            placeholder="Enter current password"
            className={cn(
              'pr-10 font-mono',
              errors.oldPassword && 'border-destructive focus-visible:ring-destructive'
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
            onClick={() => setShowOldPassword(!showOldPassword)}
            aria-label={showOldPassword ? 'Hide password' : 'Show password'}
          >
            {showOldPassword ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
        {errors.oldPassword && (
          <p className="text-xs text-destructive font-mono">{errors.oldPassword.message}</p>
        )}
      </div>

      {/* New Password */}
      <div className="space-y-2">
        <Label htmlFor="newPassword" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          New Password
        </Label>
        <div className="relative">
          <Input
            id="newPassword"
            type={showNewPassword ? 'text' : 'password'}
            {...register('newPassword')}
            placeholder="Enter new password"
            className={cn(
              'pr-10 font-mono',
              errors.newPassword && 'border-destructive focus-visible:ring-destructive'
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
            onClick={() => setShowNewPassword(!showNewPassword)}
            aria-label={showNewPassword ? 'Hide password' : 'Show password'}
          >
            {showNewPassword ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
        {errors.newPassword && (
          <p className="text-xs text-destructive font-mono">{errors.newPassword.message}</p>
        )}

        {/* Password Requirements - Chronicle styled */}
        {newPassword && (
          <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Password Requirements
            </p>
            {passwordChecks.map((check, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={cn(
                  'w-4 h-4 rounded-full flex items-center justify-center',
                  check.met ? 'bg-emerald-500/20' : 'bg-muted'
                )}>
                  <Check
                    className={cn(
                      'h-2.5 w-2.5',
                      check.met ? 'text-emerald-400' : 'text-muted-foreground/30'
                    )}
                  />
                </div>
                <span className={cn(
                  'text-xs font-mono',
                  check.met ? 'text-emerald-400' : 'text-muted-foreground'
                )}>
                  {check.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm Password */}
      <div className="space-y-2">
        <Label htmlFor="confirmPassword" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Confirm New Password
        </Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            type={showConfirmPassword ? 'text' : 'password'}
            {...register('confirmPassword')}
            placeholder="Confirm new password"
            className={cn(
              'pr-10 font-mono',
              errors.confirmPassword && 'border-destructive focus-visible:ring-destructive'
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
          >
            {showConfirmPassword ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
        {errors.confirmPassword && (
          <p className="text-xs text-destructive font-mono">{errors.confirmPassword.message}</p>
        )}
      </div>

      {/* Submit Button */}
      <div className="pt-2">
        <Button
          type="submit"
          disabled={changePassword.isPending}
          className="w-full sm:w-auto font-mono text-xs"
        >
          {changePassword.isPending ? 'Changing Password...' : 'Change Password'}
        </Button>
      </div>
    </form>
  );
}
