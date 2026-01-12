const base64urlToBuffer = (value) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return buffer
}

const bufferToBase64url = (buffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const toRegistrationOptions = (options) => ({
  ...options,
  challenge: base64urlToBuffer(options.challenge),
  user: {
    ...options.user,
    id: base64urlToBuffer(options.user.id),
  },
  excludeCredentials: (options.excludeCredentials || []).map((cred) => ({
    ...cred,
    id: base64urlToBuffer(cred.id),
  })),
})

export const toAuthenticationOptions = (options) => ({
  ...options,
  challenge: base64urlToBuffer(options.challenge),
  allowCredentials: (options.allowCredentials || []).map((cred) => ({
    ...cred,
    id: base64urlToBuffer(cred.id),
  })),
})

export const serializeCredential = (credential) => {
  if (!credential) return null
  return {
    id: credential.id,
    type: credential.type,
    rawId: bufferToBase64url(credential.rawId),
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      attestationObject: credential.response.attestationObject
        ? bufferToBase64url(credential.response.attestationObject)
        : undefined,
      authenticatorData: credential.response.authenticatorData
        ? bufferToBase64url(credential.response.authenticatorData)
        : undefined,
      signature: credential.response.signature
        ? bufferToBase64url(credential.response.signature)
        : undefined,
      userHandle: credential.response.userHandle
        ? bufferToBase64url(credential.response.userHandle)
        : null,
      transports: credential.response.getTransports
        ? credential.response.getTransports()
        : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults
      ? credential.getClientExtensionResults()
      : {},
  }
}
