export class V2ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'V2ApiError';
    this.status = status;
    this.data = data;
  }
}

export function apiErrorFromEnvelope(status, data) {
  const envelopeError = data?.error;
  const message =
    envelopeError?.message ||
    data?.message ||
    data?.detail ||
    (typeof data === 'string' ? data : null) ||
    'An error occurred';

  return new V2ApiError(message, status, data);
}

export function handleV2ApiError(error, defaultMessage = 'An error occurred') {
  if (error?.name === 'AbortError') {
    return error.message;
  }
  if (error instanceof V2ApiError) {
    return error.message || defaultMessage;
  }
  return error?.message || defaultMessage;
}
