import { serializeCredential, toAuthenticationOptions, toRegistrationOptions } from '@/lib/webauthn';

export async function browserCeremony(options, { signal, registration = false } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!window.PublicKeyCredential || window.isSecureContext === false || !navigator.credentials?.[registration ? 'create' : 'get']) throw new Error('Passkeys require a supported browser and a secure site address.');
  const { challenge_id, ...publicOptions } = options || {};
  delete publicOptions.mfa_session;
  if (!challenge_id || !publicOptions.challenge) throw new Error('The passkey challenge could not be confirmed.');
  const credential = await navigator.credentials[registration ? 'create' : 'get']({ publicKey: registration ? toRegistrationOptions(publicOptions) : toAuthenticationOptions(publicOptions), signal });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!credential) throw new DOMException('Not approved', 'NotAllowedError');
  return { challenge_id, credential: serializeCredential(credential) };
}
