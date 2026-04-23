export function isDevAuthBypassEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "development" && env.AUTH_DEV_BYPASS === "true";
}
