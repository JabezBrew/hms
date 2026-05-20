export const PASSWORD_POLICY_MIN_LENGTH = 12;

export function passwordRequirementChecks(password = '') {
  const value = String(password || '');
  return [
    { label: 'At least 12 characters', met: value.length >= PASSWORD_POLICY_MIN_LENGTH },
    { label: 'One uppercase letter', met: /[A-Z]/.test(value) },
    { label: 'One lowercase letter', met: /[a-z]/.test(value) },
    { label: 'One number', met: /[0-9]/.test(value) },
    { label: 'One special character', met: /[^A-Za-z0-9]/.test(value) },
  ];
}

export function passwordMeetsPolicy(password = '') {
  return passwordRequirementChecks(password).every((check) => check.met);
}

export function passwordPolicyErrorMessage() {
  return 'Password must be at least 12 characters and include uppercase, lowercase, number, and special character.';
}
