import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

// Get role-specific home page
const getRoleHomePage = (role) => {
  if (['nurse', 'head_nurse', 'nurse_practitioner'].includes(role)) {
    return '/patients';
  }
  if (['doctor', 'inpatient_doctor', 'practitioner', 'physician'].includes(role)) {
    return '/dashboards/inpatient';
  }
  if (['receptionist', 'front_desk'].includes(role)) {
    return '/dashboards/reception';
  }
  if (role === 'admin') {
    return '/dashboards/admin';
  }
  // Support staff go to their workflow pages
  if (['pharmacist', 'pharmacy_tech'].includes(role)) {
    return '/pharmacy/dispensing';
  }
  if (role === 'lab_technician') {
    return '/laboratory/dashboard';
  }
  if (role === 'billing') {
    return '/billing';
  }
  return '/';
};

export default function UnauthorizedPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const homePage = getRoleHomePage(user?.role);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <div className="space-y-6 max-w-md">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">Access Denied</h1>
          <p className="text-gray-500 md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed dark:text-gray-400">
            You don't have permission to access this page.
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-gray-500 dark:text-gray-400">
            Your current role: <span className="font-semibold">{user?.role || "Unknown"}</span>
          </p>
          <p className="text-gray-500 dark:text-gray-400">
            Please contact an administrator if you believe this is an error.
          </p>
        </div>
        <div className="flex flex-col gap-2 min-[400px]:flex-row justify-center">
          <Button onClick={() => navigate(-1)}>Go Back</Button>
          <Button variant="outline" onClick={() => navigate(homePage)}>Go to Dashboard</Button>
        </div>
      </div>
    </div>
  );
}
