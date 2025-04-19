import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export default function UnauthorizedPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
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
          <Button variant="outline" onClick={() => navigate("/")}>Go to Dashboard</Button>
        </div>
      </div>
    </div>
  );
}