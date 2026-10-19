import { Errors } from '../common/errors/app.exception';

export interface LockoutState {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

export function assertLoginAllowed(state: LockoutState, now: Date): void {
  if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) {
    throw Errors.locked('Account is temporarily locked. Try again later.');
  }
}

export function nextLockoutState(
  state: LockoutState,
  success: boolean,
  now: Date,
  maxAttempts: number,
  lockMinutes: number,
): LockoutState {
  if (success) return { failedLoginAttempts: 0, lockedUntil: null };
  const attempts = state.failedLoginAttempts + 1;
  if (attempts >= maxAttempts) {
    return {
      failedLoginAttempts: 0,
      lockedUntil: new Date(now.getTime() + lockMinutes * 60 * 1000),
    };
  }
  return { failedLoginAttempts: attempts, lockedUntil: null };
}
