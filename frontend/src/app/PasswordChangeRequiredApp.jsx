import { Navigate, Route, Routes } from 'react-router-dom'

import { ForcedPasswordChangeForm } from '@/components/auth/forced-password-change-form'

export default function PasswordChangeRequiredApp() {
  return (
    <Routes>
      <Route
        path="/force-password-change"
        element={
          <div className="flex min-h-screen items-center justify-center p-4">
            <ForcedPasswordChangeForm />
          </div>
        }
      />
      <Route path="*" element={<Navigate to="/force-password-change" replace />} />
    </Routes>
  )
}
