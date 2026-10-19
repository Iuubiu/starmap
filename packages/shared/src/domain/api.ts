/** API 统一错误结构（spec §契约） */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
