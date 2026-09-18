export type DataErrorCode = 'auth' | 'not_found' | 'rate_limited' | 'api';

/** A failure fetching GitHub data. The run fails and the existing banner stays. */
export class DataError extends Error {
  readonly code: DataErrorCode;
  /** When `code` is `rate_limited`: time at which a retry may succeed. */
  readonly retryAt: Date | undefined;

  constructor(code: DataErrorCode, message: string, retryAt?: Date) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.retryAt = retryAt;
  }
}
