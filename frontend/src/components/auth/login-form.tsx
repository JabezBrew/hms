import Eye from 'lucide-react/dist/esm/icons/eye.js';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js';
import LogIn from 'lucide-react/dist/esm/icons/log-in.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import { useNavigate } from 'react-router-dom';
import { useState } from "react";

import { useAuth } from "../../lib/auth"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { notifications } from "../../lib/notifications"
import { MFAChallenge } from "./MFAChallenge"

export function LoginForm() {
  const defaultFacilityCode = import.meta.env.VITE_DEFAULT_FACILITY_CODE || ""
  const multiFacilityMode =
    String(import.meta.env.VITE_MULTI_FACILITY_MODE || "").toLowerCase() === "true"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [facilityCode, setFacilityCode] = useState(defaultFacilityCode)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { login, mfaSession } = useAuth()
  const navigate = useNavigate();

  if (mfaSession) {
    return <MFAChallenge />
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await login(email, password, facilityCode);
      if (response?.mfaRequired) {
        return;
      }
      notifications.success("Logged in successfully");
      navigate('/');
    } catch (error) {
      // Error is already handled in the auth provider
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full flex-col justify-center gap-8 sm:w-[380px]">
      {/* Header */}
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <LogIn className="h-7 w-7" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Welcome Back
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to access your account
          </p>
        </div>
      </div>

      {/* Login Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Email Address
            </Label>
            <Input
              id="email"
              placeholder="name@example.com"
              type="email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect="off"
              disabled={isLoading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11"
            />
          </div>

          {multiFacilityMode && (
            <div className="space-y-2">
              <Label htmlFor="facility-code" className="text-sm font-medium">
                Facility Code
              </Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="facility-code"
                  placeholder="MAIN"
                  autoCapitalize="characters"
                  autoComplete="organization"
                  disabled={isLoading}
                  value={facilityCode}
                  onChange={(e) => setFacilityCode(e.target.value.toUpperCase())}
                  className="h-11 pl-9 font-mono tracking-wider"
                  required={multiFacilityMode}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Required for multi-facility deployments
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <a
                href="/reset-password"
                className="text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
              >
                Forgot password?
              </a>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoCapitalize="none"
                autoComplete="current-password"
                disabled={isLoading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-medium"
        >
          {isLoading ? "Signing in..." : "Sign In"}
        </Button>
      </form>

    </div>
  )
}
