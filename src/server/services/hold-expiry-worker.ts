import { expireDueHolds } from "./rebooking-service";

interface Worker {
  timer: ReturnType<typeof setInterval> | null;
  pending: Promise<number> | null;
  ready: Promise<number>;
  lastCompletedAt: string | null;
  failed: boolean;
}
const shared = globalThis as unknown as { skyflowExpiryWorker?: Worker };

/** Local process worker: persisted deadlines are swept at startup and every 30s. */
export function startHoldExpiryWorker() {
  if (process.env.NODE_ENV !== "development") return { ready: Promise.resolve(0), stop: () => undefined };
  if (shared.skyflowExpiryWorker) return handle(shared.skyflowExpiryWorker);
  const worker: Worker = { timer: null, pending: null, ready: Promise.resolve(0), lastCompletedAt: null, failed: false };
  const sweep = () => {
    if (worker.pending) return worker.pending;
    worker.pending = expireDueHolds().then((ids) => {
      worker.lastCompletedAt = new Date().toISOString(); worker.failed = false; return ids.length;
    }).catch(() => { worker.failed = true; console.error("[holds] Expiry sweep failed. Check local database migrations."); return 0; }).finally(() => { worker.pending = null; });
    return worker.pending;
  };
  worker.timer = setInterval(() => { void sweep(); }, 30_000);
  worker.timer.unref();
  shared.skyflowExpiryWorker = worker;
  worker.ready = sweep();
  return handle(worker);
}
function handle(worker: Worker) {
  return { ready: worker.ready, stop: () => { if (worker.timer) clearInterval(worker.timer); if (shared.skyflowExpiryWorker === worker) delete shared.skyflowExpiryWorker; } };
}
export function holdExpiryWorkerStatus() {
  const worker = shared.skyflowExpiryWorker;
  return { running: Boolean(worker), intervalSeconds: 30, lastCompletedAt: worker?.lastCompletedAt ?? null, failed: worker?.failed ?? false };
}
