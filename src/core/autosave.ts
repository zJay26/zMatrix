import { messageOf } from "./model";

export interface SaveStatus {
  pending: boolean;
  error: string;
}

// Coalesce each document independently. A failed write blocks every later write
// until an explicit retry, so an unrelated success cannot hide unsaved content.
export class SaveQueue {
  private jobs = new Map<string, () => Promise<unknown>>();
  private running: Promise<void> | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private error = "";
  constructor(
    private notify: (status: SaveStatus) => void,
    private delay = 350,
  ) {}

  get status(): SaveStatus {
    return { pending: !!this.running || this.jobs.size > 0, error: this.error };
  }
  enqueue(key: string, save: () => Promise<unknown>) {
    this.jobs.set(key, save);
    clearTimeout(this.timer);
    this.notify(this.status);
    if (!this.error)
      this.timer = setTimeout(() => void this.flush(), this.delay);
  }
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.error) return false;
    if (!this.running && this.jobs.size) {
      this.running = this.drain().finally(() => {
        this.running = null;
        this.notify(this.status);
      });
    }
    await this.running;
    return !this.error && this.jobs.size === 0;
  }
  async retry() {
    this.error = "";
    return this.flush();
  }
  // Only used after every local edit has been saved as a separate copy.
  discard() {
    clearTimeout(this.timer);
    this.jobs.clear();
    this.error = "";
    this.notify(this.status);
  }
  private async drain() {
    while (this.jobs.size) {
      const [key, save] = this.jobs.entries().next().value!;
      this.jobs.delete(key);
      try {
        await save();
      } catch (error) {
        const latest = this.jobs.get(key) ?? save;
        this.jobs.delete(key);
        this.jobs = new Map([[key, latest], ...this.jobs]);
        this.error = messageOf(error);
        break;
      }
    }
  }
}
