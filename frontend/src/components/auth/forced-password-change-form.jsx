import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'

import { useAuth } from '@/lib/auth'
import { notifications } from '@/lib/notifications'
import { passwordMeetsPolicy, passwordPolicyErrorMessage } from '@/lib/password-policy'
import { useChangePassword } from '@/features/settings/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const forcedPasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .refine(passwordMeetsPolicy, passwordPolicyErrorMessage()),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})

export function ForcedPasswordChangeForm() {
  const navigate = useNavigate()
  const { clearPasswordChangeRequirement, logout } = useAuth()
  const changePassword = useChangePassword()

  const [showOldPassword, setShowOldPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(forcedPasswordSchema),
    defaultValues: {
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  const onSubmit = async (data) => {
    try {
      await changePassword.mutateAsync({
        oldPassword: data.oldPassword,
        newPassword: data.newPassword,
      })
      clearPasswordChangeRequirement()
      notifications.success('Password updated successfully')
      navigate('/', { replace: true })
    } catch (error) {
      notifications.error(error.message || 'Failed to update password')
    }
  }

  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-5 space-y-2 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <ShieldAlert className="size-6" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Update Your Password</h1>
        <p className="text-sm text-muted-foreground">
          For security, you must change your password before continuing.
        </p>
      </div>

      <Alert className="mb-5 border-amber-500/30 bg-amber-500/5">
        <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">
          Your current password appears to be temporary or administrator-reset.
        </AlertDescription>
      </Alert>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="oldPassword">Current Password</Label>
          <div className="relative">
            <Input
              id="oldPassword"
              type={showOldPassword ? 'text' : 'password'}
              {...register('oldPassword')}
              disabled={changePassword.isPending}
              className="pr-10"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowOldPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showOldPassword ? 'Hide password' : 'Show password'}
            >
              {showOldPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {errors.oldPassword && <p className="text-xs text-destructive">{errors.oldPassword.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="newPassword">New Password</Label>
          <div className="relative">
            <Input
              id="newPassword"
              type={showNewPassword ? 'text' : 'password'}
              {...register('newPassword')}
              disabled={changePassword.isPending}
              className="pr-10"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showNewPassword ? 'Hide password' : 'Show password'}
            >
              {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm New Password</Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              {...register('confirmPassword')}
              disabled={changePassword.isPending}
              className="pr-10"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
            >
              {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
        </div>

        <Button type="submit" className="w-full" disabled={changePassword.isPending}>
          {changePassword.isPending ? 'Updating Password...' : 'Update Password'}
        </Button>
      </form>

      <div className="mt-4 text-center">
        <Button variant="ghost" size="sm" onClick={() => logout()} disabled={changePassword.isPending}>
          Sign out instead
        </Button>
      </div>
    </div>
  )
}
