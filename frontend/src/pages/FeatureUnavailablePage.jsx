import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

const getRoleHomePage = (role) => {
  if (['nurse', 'head_nurse', 'nurse_practitioner'].includes(role)) {
    return '/patients'
  }
  if (['doctor', 'inpatient_doctor', 'practitioner', 'physician'].includes(role)) {
    return '/dashboards/inpatient'
  }
  if (['receptionist', 'front_desk'].includes(role)) {
    return '/dashboards/reception'
  }
  if (role === 'admin') {
    return '/dashboards/admin'
  }
  return '/'
}

export default function FeatureUnavailablePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const homePage = getRoleHomePage(user?.role)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <div className="max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            Feature Unavailable
          </h1>
          <p className="text-gray-500 md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed dark:text-gray-400">
            This module is not enabled for the current deployment.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-2 min-[400px]:flex-row">
          <Button onClick={() => navigate(-1)}>Go Back</Button>
          <Button variant="outline" onClick={() => navigate(homePage)}>Go to Dashboard</Button>
        </div>
      </div>
    </div>
  )
}
