export type ValetErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_STATE'
  | 'INVALID_SETTINGS'
  | 'SLOT_OCCUPIED'
  | 'TASK_TAKEN'
  | 'BALANCE_DUE'
  | 'CONFIRMATION_REQUIRED'
  | 'VERIFICATION_FAILED'
  | 'SCHEMA_MISMATCH';

export class ValetError extends Error {
  constructor(
    readonly code: ValetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ValetError';
  }
}
