import type { JsonObject } from './common'

export type QueryParamScalar = string | number | boolean
export type QueryParamValue = QueryParamScalar | QueryParamScalar[] | null | undefined

export type ResponseParseMode = 'blob' | 'arrayBuffer' | 'text'

export interface ApiRequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
  params?: Record<string, QueryParamValue>
  parseAs?: ResponseParseMode
}

export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface JwtPayload {
  exp?: number
  [key: string]: unknown
}

export interface ApiErrorPayload extends JsonObject {
  detail?: string
  message?: string
  retry_after?: number
}

export interface ApiClient {
  get<T = unknown>(endpoint: string, options?: ApiRequestOptions): Promise<T | T[]>
  getAll<T = unknown>(endpoint: string, options?: ApiRequestOptions): Promise<T[]>
  getWithPagination<T = unknown>(endpoint: string, options?: ApiRequestOptions): Promise<PaginatedResponse<T> | T>
  getBlob(endpoint: string, options?: ApiRequestOptions): Promise<Blob>
  post<TResponse = unknown, TPayload = unknown>(endpoint: string, data?: TPayload, options?: ApiRequestOptions): Promise<TResponse>
  postForm<TResponse = unknown>(endpoint: string, formData: FormData, options?: ApiRequestOptions): Promise<TResponse>
  put<TResponse = unknown, TPayload = unknown>(endpoint: string, data?: TPayload, options?: ApiRequestOptions): Promise<TResponse>
  patch<TResponse = unknown, TPayload = unknown>(endpoint: string, data?: TPayload, options?: ApiRequestOptions): Promise<TResponse>
  delete<TResponse = unknown>(endpoint: string, options?: ApiRequestOptions): Promise<TResponse>
}
