export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "development") {
    const { startHoldExpiryWorker } = await import("./server/services/hold-expiry-worker");
    await startHoldExpiryWorker().ready;
  }
}
