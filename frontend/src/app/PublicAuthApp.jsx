import { Navigate, Route, Routes } from 'react-router-dom'

import { LoginForm } from '@/components/auth/login-form'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { ResetPasswordConfirmForm } from '@/components/auth/reset-password-confirm-form'
import Activity from 'lucide-react/dist/esm/icons/activity.js'

function AuthLayout({ children }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 sm:py-16">
      <main className="flex w-full max-w-[460px] flex-col gap-7">
        <a href="/login" className="flex w-fit items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" aria-label="HMS sign in">
          <span className="flex size-10 items-center justify-center rounded-xl border border-primary/15 bg-primary/5 text-primary">
            <Activity className="size-5" aria-hidden="true" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold tracking-wide">HMS</span>
            <span className="text-xs text-muted-foreground">Clinical workspace</span>
          </span>
        </a>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-9">
          {children}
        </div>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">For authorized hospital staff. Use your assigned account to continue.</p>
      </main>
    </div>
  )
}

export default function PublicAuthApp() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <AuthLayout>
            <LoginForm />
          </AuthLayout>
        }
      />
      <Route
        path="/reset-password"
        element={
          <AuthLayout>
            <ResetPasswordForm />
          </AuthLayout>
        }
      />
      <Route
        path="/reset-password/confirm"
        element={
          <AuthLayout>
            <ResetPasswordConfirmForm />
          </AuthLayout>
        }
      />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )
}
