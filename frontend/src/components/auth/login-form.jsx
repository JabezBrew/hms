import Eye from 'lucide-react/dist/esm/icons/eye.js';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js';
import { useNavigate } from 'react-router-dom';
import { useReducer, useRef } from "react";

import { useAuth } from "../../lib/auth.jsx"
import { isRustV2ApiMode } from "../../lib/api/v2/runtime"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import { notifications } from "../../lib/notifications"
import { getDefaultFacilityCode, isMultiFacilityModeEnabled } from "../../lib/runtime-config"
import { MFAChallenge } from "./MFAChallenge"

function createInitialLoginFormState() {
  return {
    email: "",
    password: "",
    facilityCode: getDefaultFacilityCode() || "",
    showPassword: false,
    isLoading: false,
  }
}

function loginFormReducer(state, action) {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch }
    default:
      return state
  }
}

export function LoginForm() {
  const [state, dispatch] = useReducer(loginFormReducer, null, createInitialLoginFormState)
  const { email, password, facilityCode, showPassword, isLoading } = state
  const isSubmittingRef = useRef(false)
  const { login, mfaSession } = useAuth()
  const navigate = useNavigate();
  const showFacilityCode = isRustV2ApiMode() || isMultiFacilityModeEnabled()

  if (mfaSession) {
    return <MFAChallenge />
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;
    dispatch({ type: "patch", patch: { isLoading: true } })

    try {
      const normalizedFacilityCode = facilityCode.trim().toUpperCase()
      const response = showFacilityCode
        ? await login(email.trim(), password, normalizedFacilityCode)
        : await login(email.trim(), password);
      if (response?.mfaRequired) {
        return;
      }
      notifications.success("Logged in successfully");
      navigate('/');
    } catch {
      // Error is already handled in the auth provider
    } finally {
      isSubmittingRef.current = false;
      dispatch({ type: "patch", patch: { isLoading: false } })
    }
  }

  return (
    <div className="mx-auto flex w-full min-w-0 flex-col justify-center gap-7">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Welcome Back
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your clinical workspace.
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
              onChange={(e) => dispatch({ type: "patch", patch: { email: e.target.value } })}
              required
              className="h-11"
            />
          </div>

          {showFacilityCode && (
            <div className="space-y-2">
              <Label htmlFor="facility-code" className="text-sm font-medium">
                Facility Code
              </Label>
              <Input
                id="facility-code"
                placeholder="HMS"
                type="text"
                autoCapitalize="characters"
                autoComplete="organization"
                autoCorrect="off"
                disabled={isLoading}
                value={facilityCode}
                onChange={(e) => dispatch({ type: "patch", patch: { facilityCode: e.target.value.toUpperCase() } })}
                required
                className="h-11 font-mono uppercase"
              />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <a
                href="/reset-password"
                className="rounded-sm text-xs font-medium text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
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
                onChange={(e) => dispatch({ type: "patch", patch: { password: e.target.value } })}
                className="h-11 pr-12"
                required
              />
              <button
                type="button"
                onClick={() => dispatch({ type: "patch", patch: { showPassword: !showPassword } })}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={isLoading}
                className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="h-11 w-full font-semibold"
        >
          {isLoading ? "Signing in..." : "Sign In"}
        </Button>
      </form>

    </div>
  )
}
