// Core logic never calls Date.now() directly; it takes a Clock so tests can freeze time.
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
export const fixedClock = (d: Date): Clock => ({ now: () => d });
