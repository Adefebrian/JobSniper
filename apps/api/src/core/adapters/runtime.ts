import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CredentialStore, Clock, IdGenerator } from "../ports/runtime";

const execFileAsync = promisify(execFile);

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  newId(): string {
    return randomUUID();
  }
}

export class MacKeychainCredentialStore implements CredentialStore {
  private readonly service: string;

  constructor(service = "JobSniper") {
    this.service = service;
  }

  async get(name: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        this.service,
        "-a",
        name,
        "-w",
      ]);
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  async set(name: string, value: string): Promise<void> {
    await execFileAsync("security", [
      "add-generic-password",
      "-U",
      "-s",
      this.service,
      "-a",
      name,
      "-w",
      value,
    ]);
  }

  async delete(name: string): Promise<void> {
    try {
      await execFileAsync("security", [
        "delete-generic-password",
        "-s",
        this.service,
        "-a",
        name,
      ]);
    } catch {
      // A missing secret is already in the desired state.
    }
  }
}

export type RuntimeMaintenanceTasks = {
  catchUp(): Promise<unknown>;
  trackReplies(): Promise<unknown>;
  onError(error: unknown): void;
};

export type RuntimeMaintenanceOptions = {
  tickMs?: number;
  wakeGapMs?: number;
  replyIntervalMs?: number;
};

export class RuntimeMaintenance {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTickAt = Date.now();
  private nextReplyAt = Date.now();
  private running = false;

  constructor(
    private readonly tasks: RuntimeMaintenanceTasks,
    private readonly options: RuntimeMaintenanceOptions = {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.lastTickAt = Date.now();
    this.nextReplyAt = Date.now();
    void this.runLaunch();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.tickMs ?? 60_000);
  }

  async tick(now = Date.now()): Promise<void> {
    const previous = this.lastTickAt;
    this.lastTickAt = now;
    if (now - previous >= (this.options.wakeGapMs ?? 120_000)) {
      await this.safe(this.tasks.catchUp);
    }
    if (now >= this.nextReplyAt) {
      this.nextReplyAt = now + (this.options.replyIntervalMs ?? 3_600_000);
      await this.safe(this.tasks.trackReplies);
    }
  }

  async triggerWake(): Promise<void> {
    await this.safe(this.tasks.catchUp);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async runLaunch(): Promise<void> {
    await this.safe(this.tasks.catchUp);
    this.nextReplyAt = Date.now() + (this.options.replyIntervalMs ?? 3_600_000);
    await this.safe(this.tasks.trackReplies);
  }

  private async safe(task: () => Promise<unknown>): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await task();
    } catch (error) {
      this.tasks.onError(error);
    } finally {
      this.running = false;
    }
  }
}
