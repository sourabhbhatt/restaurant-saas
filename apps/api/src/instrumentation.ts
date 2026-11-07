/** Loads the composition root once per server so `getContainer()` has a factory. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("@/composition/container");
}
