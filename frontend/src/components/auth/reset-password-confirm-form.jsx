import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js';
import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { authApi } from '../../lib/api/auth'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Alert, AlertDescription } from '../ui/alert'
import { notifications } from '../../lib/notifications'

export function ResetPasswordConfirmForm() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [isValidating, setIsValidating] = useState(true)
  const [isTokenValid, setIsTokenValid] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setIsValidating(false)
        setError('No reset token provided.')
        return
      }

      try {
        const response = await authApi.validateResetToken(token)
        if (response.valid) {
          setIsTokenValid(true)
          setUserEmail(response.email)
        } else {
          setError(response.detail || 'Invalid or expired reset token.')
        }
      } catch (err) {
        setError('Failed to validate token. Please request a new reset link.')
      } finally {
        setIsValidating(false)
      }
    }

    validateToken()
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (password !== passwordConfirm) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setIsSubmitting(true)

    try {
      await authApi.resetPassword(token, password, passwordConfirm)
      setIsSuccess(true)
      notifications.success('Password reset successfully!')

      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError(err.message || 'Failed to reset password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isValidating) {
    return (
      <div className="mx-auto flex w-full flex-col items-center justify-center space-y-6 sm:w-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Validating reset link...</p>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className="mx-auto flex w-full flex-col items-center justify-center space-y-6 sm:w-[400px]">
        <CheckCircle className="h-16 w-16 text-green-500" aria-hidden="true" />
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Password Reset Complete</h1>
          <p className="mt-2 text-sm text-muted-foreground">Redirecting to login...</p>
        </div>
        <Button asChild><a href="/login">Go to Login</a></Button>
      </div>
    )
  }

  if (!isTokenValid) {
    return (
      <div className="mx-auto flex w-full flex-col items-center justify-center space-y-6 sm:w-[400px]">
        <XCircle className="h-16 w-16 text-red-500" aria-hidden="true" />
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Invalid Reset Link</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
        <Button asChild><a href="/reset-password">Request New Reset Link</a></Button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[400px]">
      <div className="flex flex-col space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Create New Password</h1>
        <p className="text-sm text-muted-foreground">Enter a new password for {userEmail}</p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="grid gap-2">
          <Label htmlFor="password">New Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={isSubmitting}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="passwordConfirm">Confirm Password</Label>
          <Input
            id="passwordConfirm"
            type={showPassword ? 'text' : 'password'}
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            required
            minLength={8}
            disabled={isSubmitting}
          />
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Resetting...</> : 'Reset Password'}
        </Button>
      </form>

      <div className="text-center text-sm">
        <a href="/login" className="text-primary hover:underline">Back to Login</a>
      </div>
    </div>
  )
}
