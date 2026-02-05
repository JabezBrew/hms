import { Navigate, Route, Routes } from 'react-router-dom'

import { LoginForm } from '@/components/auth/login-form'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { ResetPasswordConfirmForm } from '@/components/auth/reset-password-confirm-form'

export default function PublicAuthApp() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <div className="flex min-h-screen items-center justify-center">
            <LoginForm />
          </div>
        }
      />
      <Route
        path="/reset-password"
        element={
          <div className="flex min-h-screen items-center justify-center">
            <ResetPasswordForm />
          </div>
        }
      />
      <Route
        path="/reset-password/confirm"
        element={
          <div className="flex min-h-screen items-center justify-center">
            <ResetPasswordConfirmForm />
          </div>
        }
      />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )
}
