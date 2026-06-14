import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Worker } from 'worker_threads';
import * as path from 'path';
import { MatrixTask, MatrixResult } from './matrix.worker';

type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

interface PendingTask {
  task: MatrixTask;
  priority: TaskPriority;
  resolve: (result: MatrixResult) => void;
  reject: (error: Error) => void;
  timeoutHandle: any;
  createdAt: number;
  tankId?: string;
}

interface WorkerWrapper {
  worker: Worker;
  isBusy: boolean;
  currentTaskId?: string;
  tasksCompleted: number;
  totalComputeTimeMs: number;
  lastActiveAt: number;
}

export interface WorkerPoolMetrics {
  poolSize: number;
  activeWorkers: number;
  idleWorkers: number;
  queueLength: number;
  queueHighWater: number;
  tasksCompleted: number;
  tasksRejected: number;
  tasksTimedOut: number;
  avgComputeTimeMs: number;
  avgWaitTimeMs: number;
  isHealthy: boolean;
}

const PRIORITY_ORDER: { [K in TaskPriority]: number } = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

@Injectable()
export class WorkerPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerPoolService.name);
  private workers: WorkerWrapper[] = [];
  private queue: PendingTask[] = [];
  private readonly poolSize: number;
  private readonly maxQueueLength: number;
  private readonly defaultTimeoutMs: number;
  private readonly HIGH_WATER_MARK = 1000;
  private readonly LOW_WATER_MARK = 200;
  private isBackPressureActive = false;

  private totalTasksCompleted = 0;
  private totalTasksRejected = 0;
  private totalTasksTimedOut = 0;
  private totalComputeTimeMs = 0;
  private totalWaitTimeMs = 0;
  private queueHighWater = 0;
  private workerFilePath: string;

  constructor() {
    const cpuCount = require('os').cpus().length;
    this.poolSize = Math.max(2, Math.min(cpuCount - 1, 8));
    this.maxQueueLength = 5000;
    this.defaultTimeoutMs = 5000;

    const distPath = path.resolve(__dirname, 'matrix.worker.js');
    const srcPath = path.resolve(__dirname, '..', '..', 'src', 'worker', 'matrix.worker.ts');
    this.workerFilePath = require('fs').existsSync(distPath) ? distPath : srcPath;

    this.logger.log(
      `WorkerPool initialized: size=${this.poolSize}, maxQueue=${this.maxQueueLength}, timeout=${this.defaultTimeoutMs}ms, worker=${this.workerFilePath}`
    );
  }

  onModuleInit() {
    this.spawnWorkers();
  }

  onModuleDestroy() {
    this.shutdown();
  }

  private spawnWorkers() {
    for (let i = 0; i < this.poolSize; i++) {
      this.createWorker(i);
    }
  }

  private createWorker(index: number): WorkerWrapper {
    const worker = new Worker(this.workerFilePath, {
      workerData: { workerIndex: index },
    });

    const wrapper: WorkerWrapper = {
      worker,
      isBusy: false,
      tasksCompleted: 0,
      totalComputeTimeMs: 0,
      lastActiveAt: Date.now(),
    };

    worker.on('message', (result: MatrixResult) => {
      this.handleWorkerResult(wrapper, result);
    });

    worker.on('error', (err) => {
      this.logger.error(`Worker ${index} error: ${err.message}`, err.stack);
      this.replaceWorker(wrapper, index);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        this.logger.warn(`Worker ${index} exited with code ${code}, respawning...`);
        this.replaceWorker(wrapper, index);
      }
    });

    this.workers.push(wrapper);
    return wrapper;
  }

  private replaceWorker(wrapper: WorkerWrapper, index: number) {
    try {
      wrapper.worker.terminate();
    } catch (_) {}

    const idx = this.workers.indexOf(wrapper);
    if (idx > -1) this.workers.splice(idx, 1);

    if (wrapper.isBusy && wrapper.currentTaskId) {
      this.logger.warn(`Task ${wrapper.currentTaskId} lost due to worker crash`);
      this.totalTasksRejected++;
    }

    this.createWorker(index);
    this.processQueue();
  }

  submit(
    task: MatrixTask,
    options: { priority?: TaskPriority; timeoutMs?: number; tankId?: string } = {}
  ): Promise<MatrixResult> {
    const priority = options.priority || 'normal';
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;

    if (this.shouldRejectTask(priority)) {
      this.totalTasksRejected++;
      return Promise.resolve({
        id: task.id,
        success: false,
        error: 'Backpressure active: queue overflow, task rejected',
        computeTimeMs: 0,
      });
    }

    return new Promise<MatrixResult>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.handleTaskTimeout(task.id);
        reject(new Error(`Task ${task.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const pending: PendingTask = {
        task,
        priority,
        resolve,
        reject,
        timeoutHandle,
        createdAt: Date.now(),
        tankId: options.tankId,
      };

      this.enqueue(pending);
      this.processQueue();
    });
  }

  private shouldRejectTask(priority: TaskPriority): boolean {
    const qLen = this.queue.length;

    if (qLen >= this.maxQueueLength) return true;

    if (qLen >= this.HIGH_WATER_MARK) {
      if (!this.isBackPressureActive) {
        this.logger.warn(`Backpressure activated: queue=${qLen} >= HIGH_WATER=${this.HIGH_WATER_MARK}`);
        this.isBackPressureActive = true;
      }
      if (priority === 'low') return true;
    } else if (this.isBackPressureActive && qLen <= this.LOW_WATER_MARK) {
      this.logger.log(`Backpressure released: queue=${qLen} <= LOW_WATER=${this.LOW_WATER_MARK}`);
      this.isBackPressureActive = false;
    }

    if (qLen >= this.HIGH_WATER_MARK * 1.5 && priority !== 'critical') {
      return true;
    }

    return false;
  }

  private enqueue(pending: PendingTask) {
    const order = PRIORITY_ORDER[pending.priority];

    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (PRIORITY_ORDER[this.queue[i].priority] > order) {
        this.queue.splice(i, 0, pending);
        inserted = true;
        break;
      }
    }
    if (!inserted) this.queue.push(pending);

    if (this.queue.length > this.queueHighWater) {
      this.queueHighWater = this.queue.length;
    }
  }

  private processQueue() {
    if (this.queue.length === 0) return;

    const idleWorker = this.workers.find(w => !w.isBusy);
    if (!idleWorker) return;

    const pending = this.queue.shift();
    if (!pending) return;

    this.dispatchToWorker(idleWorker, pending);
    this.processQueue();
  }

  private dispatchToWorker(worker: WorkerWrapper, pending: PendingTask) {
    worker.isBusy = true;
    worker.currentTaskId = pending.task.id;
    worker.lastActiveAt = Date.now();

    const waitTime = Date.now() - pending.createdAt;
    this.totalWaitTimeMs += waitTime;

    try {
      worker.worker.postMessage(pending.task);
    } catch (err: any) {
      this.logger.error(`Failed to dispatch task ${pending.task.id}: ${err.message}`);
      clearTimeout(pending.timeoutHandle);
      pending.reject(err);
      worker.isBusy = false;
      worker.currentTaskId = undefined;
      this.processQueue();
    }
  }

  private handleWorkerResult(worker: WorkerWrapper, result: MatrixResult) {
    const taskId = worker.currentTaskId;
    clearTimeout((this as any)._timeoutHandles?.get(taskId));

    worker.isBusy = false;
    worker.currentTaskId = undefined;
    worker.tasksCompleted++;
    worker.totalComputeTimeMs += result.computeTimeMs;
    worker.lastActiveAt = Date.now();

    this.totalTasksCompleted++;
    this.totalComputeTimeMs += result.computeTimeMs;

    const pending = this.findAndRemovePending(result.id);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      pending.resolve(result);
    }

    this.processQueue();
  }

  private findAndRemovePending(taskId: string): PendingTask | undefined {
    const idx = this.queue.findIndex(p => p.task.id === taskId);
    if (idx === -1) return undefined;
    const [pending] = this.queue.splice(idx, 1);
    return pending;
  }

  private handleTaskTimeout(taskId: string) {
    this.totalTasksTimedOut++;
    this.logger.warn(`Task ${taskId} timed out`);
    this.findAndRemovePending(taskId);
  }

  getMetrics(): WorkerPoolMetrics {
    const active = this.workers.filter(w => w.isBusy).length;
    const completed = this.totalTasksCompleted;
    return {
      poolSize: this.poolSize,
      activeWorkers: active,
      idleWorkers: this.workers.length - active,
      queueLength: this.queue.length,
      queueHighWater: this.queueHighWater,
      tasksCompleted: completed,
      tasksRejected: this.totalTasksRejected,
      tasksTimedOut: this.totalTasksTimedOut,
      avgComputeTimeMs: completed > 0 ? this.totalComputeTimeMs / completed : 0,
      avgWaitTimeMs: completed > 0 ? this.totalWaitTimeMs / completed : 0,
      isHealthy: active < this.poolSize && this.queue.length < this.HIGH_WATER_MARK,
    };
  }

  shutdown() {
    this.logger.log('Shutting down worker pool...');
    for (const wrapper of this.workers) {
      try {
        wrapper.worker.terminate();
      } catch (_) {}
    }
    this.workers = [];

    for (const pending of this.queue) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error('Worker pool shutting down'));
    }
    this.queue = [];
  }
}
