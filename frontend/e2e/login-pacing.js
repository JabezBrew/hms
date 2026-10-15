// Independent browser contexts still share the synthetic account's server-side
// login limit. Pace successful logins without changing that security policy.
const loginStarts = new Map();
const minimumLoginIntervalMs = 6_200;

export async function paceIdentityLogin(email, facilityCode = 'HMS') {
  const identity = `${facilityCode.trim().toLowerCase()}:${email.trim().toLowerCase()}`;
  const previousStart = loginStarts.get(identity);
  const remaining = previousStart === undefined
    ? 0
    : Math.max(0, minimumLoginIntervalMs - (Date.now() - previousStart));
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  loginStarts.set(identity, Date.now());
}
