// Small worker pool: N module workers, at most `maxInflight` jobs each. The World owns the job queue/priorities.
export class WorkerPool {
  /**
   * @param {number} n worker count
   * @param {(data:object)=>void} onResult called for every worker message
   * @param {number} [maxInflight]
   * @param {(msg:object)=>void} [onFail] called with the job message of a job lost to a worker crash
   */
  constructor(n, onResult, maxInflight = 2, onFail = null) {
    this.onResult = onResult; this.onFail = onFail; this.maxInflight = maxInflight;
    this.workers = []; this.inflight = []; this.pending = [];
    this.resize(n);
  }
  resize(n) {
    n = Math.max(1, n | 0);
    while (this.workers.length < n) {
      const w = new Worker(new URL('./chunk.worker.js', import.meta.url), { type: 'module' });
      const i = this.workers.length;
      w.onmessage = (e) => {
        this.inflight[i]--;
        const d = e.data, p = this.pending[i], k = p.findIndex(m => m.id === d.id && (m.type === d.kind || m.type === d.type));
        if (k >= 0) p.splice(k, 1);
        this.onResult(d);
      };
      w.onerror = (e) => {
        console.error('[HZ] world worker error', e.message || e);
        const m = this.pending[i].shift();
        this.inflight[i] = Math.max(0, this.inflight[i] - 1);
        if (m && this.onFail) this.onFail(m);
      };
      this.workers.push(w); this.inflight.push(0); this.pending.push([]);
    }
    this.active = n; // workers beyond `active` finish current jobs but get no new ones
  }
  /** number of jobs that can be posted right now */
  free() {
    let f = 0;
    for (let i = 0; i < this.active; i++) f += this.maxInflight - this.inflight[i];
    return f;
  }
  busy() { let b = 0; for (let i = 0; i < this.workers.length; i++) if (this.inflight[i] > 0) b++; return b; }
  post(msg) {
    let best = -1, bl = 1e9;
    for (let i = 0; i < this.active; i++) if (this.inflight[i] < bl) { bl = this.inflight[i]; best = i; }
    if (best < 0 || bl >= this.maxInflight) return false;
    this.inflight[best]++; this.pending[best].push(msg);
    this.workers[best].postMessage(msg);
    return true;
  }
  dispose() { for (const w of this.workers) w.terminate(); this.workers.length = 0; this.inflight.length = 0; this.pending.length = 0; }
}
