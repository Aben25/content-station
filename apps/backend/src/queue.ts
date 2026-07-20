export type JobType =
  | "inspect"
  | "transcribe"
  | "plan"
  | "render"
  | "finalize";

export interface Job {
  id: string;
  captureId: string;
  type: JobType;
  attempts: number;
  run(): Promise<void>;
}

type Handler = () => Promise<void>;

/// Minimal in-process FIFO queue. One worker at a time keeps ffmpeg and
/// whisper from contending for CPU on the dev machine. Swap for BullMQ +
/// Redis in Phase 4 without changing the pipeline code.
export class JobQueue {
  private pending: Handler[] = [];
  private running = false;
  private failedCount = 0;
  private completedCount = 0;

  enqueue(handler: Handler): void {
    this.pending.push(handler);
    void this.drain();
  }

  get stats() {
    return {
      pending: this.pending.length,
      running: this.running,
      completed: this.completedCount,
      failed: this.failedCount,
    };
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.pending.length > 0) {
      const handler = this.pending.shift()!;
      try {
        await handler();
        this.completedCount++;
      } catch (err) {
        this.failedCount++;
        console.error("[queue] job failed:", err);
      }
    }
    this.running = false;
  }
}

export const queue = new JobQueue();
