/**
 * The shape of a plan key (starter, pro, ...): one rule for the platform's
 * form validation (`planKeySchema` in platform.ts) and the analytics catalog
 * (tracking-events.ts). Plain values, no zod: the catalog ships to the browser.
 */
export const PLAN_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const PLAN_KEY_MIN_LENGTH = 2;
export const PLAN_KEY_MAX_LENGTH = 40;
