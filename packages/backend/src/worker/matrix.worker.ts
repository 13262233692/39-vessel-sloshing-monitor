import { parentPort, isMainThread } from 'worker_threads';

export type Matrix = number[][];

export interface MatrixTask {
  id: string;
  type: 'pseudoinverse' | 'gaussianElimination' | 'jacobian' | 'gzCurve' | 'stabilitySensitivity';
  payload: any;
}

export interface MatrixResult {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
  computeTimeMs: number;
}

function createMatrix(rows: number, cols: number, fill = 0): Matrix {
  const m: Matrix = new Array(rows);
  for (let i = 0; i < rows; i++) {
    m[i] = new Array(cols).fill(fill);
  }
  return m;
}

function cloneMatrix(a: Matrix): Matrix {
  return a.map(row => row.slice());
}

function transpose(a: Matrix): Matrix {
  const rows = a.length;
  const cols = a[0].length;
  const result: Matrix = createMatrix(cols, rows);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = a[i][j];
    }
  }
  return result;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const rowsA = a.length;
  const colsA = a[0].length;
  const colsB = b[0].length;
  const result: Matrix = createMatrix(rowsA, colsB);
  for (let i = 0; i < rowsA; i++) {
    for (let k = 0; k < colsA; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < colsB; j++) {
        result[i][j] += aik * b[k][j];
      }
    }
  }
  return result;
}

function gaussianEliminationSolve(A: Matrix, b: number[]): number[] {
  const n = A.length;
  const aug: Matrix = createMatrix(n, n + 1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      aug[i][j] = A[i][j];
    }
    aug[i][n] = b[i];
  }

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) continue;
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    const pivot = aug[col][col];
    for (let j = col; j <= n; j++) {
      aug[col][j] /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    x[i] = aug[i][n];
  }
  return x;
}

function moorePenrosePseudoinverse(A: Matrix): Matrix {
  const rows = A.length;
  const cols = A[0].length;

  if (rows >= cols) {
    const At = transpose(A);
    const AtA = multiply(At, A);
    const n = AtA.length;
    const invAtA: Matrix = createMatrix(n, n);
    for (let j = 0; j < n; j++) {
      const e = new Array(n).fill(0);
      e[j] = 1;
      const col = gaussianEliminationSolve(AtA, e);
      for (let i = 0; i < n; i++) {
        invAtA[i][j] = col[i];
      }
    }
    return multiply(invAtA, At);
  } else {
    const At = transpose(A);
    const AAt = multiply(A, At);
    const n = AAt.length;
    const invAAt: Matrix = createMatrix(n, n);
    for (let j = 0; j < n; j++) {
      const e = new Array(n).fill(0);
      e[j] = 1;
      const col = gaussianEliminationSolve(AAt, e);
      for (let i = 0; i < n; i++) {
        invAAt[i][j] = col[i];
      }
    }
    return multiply(At, invAAt);
  }
}

function computeJacobian(
  fn: (x: number[]) => number[],
  x: number[],
  eps = 1e-6
): Matrix {
  const n = x.length;
  const f0 = fn(x);
  const m = f0.length;
  const J: Matrix = createMatrix(m, n);

  for (let j = 0; j < n; j++) {
    const xPlus = x.slice();
    xPlus[j] += eps;
    const fPlus = fn(xPlus);
    for (let i = 0; i < m; i++) {
      J[i][j] = (fPlus[i] - f0[i]) / eps;
    }
  }
  return J;
}

interface GzCurveParams {
  gm: number;
  displacement: number;
  beam: number;
  kb: number;
  bm: number;
  fillingRatio: number;
  freeSurfaceEffect: number;
  sloshingMoment: number;
}

function computeGZCurve(params: GzCurveParams): { angles: number[]; gz: number[]; maxGZ: number; angleOfMaxGZ: number; range: number } {
  const step = 1;
  const angles: number[] = [];
  const gz: number[] = [];
  let maxGZ = -Infinity;
  let angleOfMaxGZ = 0;
  let range = 0;

  const { gm, beam, fillingRatio, freeSurfaceEffect, sloshingMoment } = params;
  const correctedGM = gm - freeSurfaceEffect;
  const sloshingFactor = Math.min(1, Math.abs(sloshingMoment) / 1e6);

  for (let deg = 0; deg <= 90; deg += step) {
    const rad = (deg * Math.PI) / 180;
    let gzVal = correctedGM * Math.sin(rad);

    const shapeFactor = 1 - 0.5 * Math.pow(rad / (Math.PI / 2), 2);
    gzVal *= shapeFactor;

    const bilgeKeelEffect = 0.15 * beam * Math.sin(rad) * Math.cos(rad);
    gzVal += bilgeKeelEffect;

    const fillingPenalty = Math.abs(fillingRatio - 0.5) * 0.2;
    gzVal *= (1 - fillingPenalty);

    gzVal *= (1 - sloshingFactor * 0.4);

    if (isNaN(gzVal) || !isFinite(gzVal)) gzVal = 0;

    angles.push(deg);
    gz.push(gzVal);

    if (gzVal > maxGZ) {
      maxGZ = gzVal;
      angleOfMaxGZ = deg;
    }
    if (gzVal > 0) {
      range = deg;
    }
  }

  return { angles, gz, maxGZ, angleOfMaxGZ, range };
}

function computeStabilitySensitivity(
  params: GzCurveParams,
  perturbations: { [key: string]: number }
): { param: string; sensitivity: number; partialDerivative: number }[] {
  const baseCurve = computeGZCurve(params);
  const baseMetric = baseCurve.maxGZ * (baseCurve.range / 30);
  const results: { param: string; sensitivity: number; partialDerivative: number }[] = [];

  for (const [param, delta] of Object.entries(perturbations)) {
    const perturbedParams = { ...params };
    const originalValue = (perturbedParams as any)[param];
    (perturbedParams as any)[param] = originalValue + delta;

    const perturbedCurve = computeGZCurve(perturbedParams);
    const perturbedMetric = perturbedCurve.maxGZ * (perturbedCurve.range / 30);

    const partialDerivative = (perturbedMetric - baseMetric) / delta;
    const sensitivity = Math.abs(partialDerivative * originalValue / (baseMetric + 1e-12));

    results.push({ param, sensitivity, partialDerivative });
  }

  return results.sort((a, b) => b.sensitivity - a.sensitivity);
}

function handleTask(task: MatrixTask): MatrixResult {
  const start = performance.now();
  try {
    switch (task.type) {
      case 'pseudoinverse': {
        const A = task.payload.matrix as Matrix;
        const result = moorePenrosePseudoinverse(A);
        return { id: task.id, success: true, data: { pseudoinverse: result }, computeTimeMs: performance.now() - start };
      }
      case 'gaussianElimination': {
        const { A, b } = task.payload;
        const result = gaussianEliminationSolve(A, b);
        return { id: task.id, success: true, data: { solution: result }, computeTimeMs: performance.now() - start };
      }
      case 'jacobian': {
        const { fnKey, x, eps } = task.payload;
        const fnMap: { [key: string]: (x: number[]) => number[] } = {
          sloshingDynamics: (vars: number[]) => {
            const [amplitude, frequency, damping, fillingRatio, rollAngle] = vars;
            const omega = 2 * Math.PI * frequency;
            const force = amplitude * omega * omega * Math.exp(-damping);
            const energy = 0.5 * amplitude * amplitude * omega * omega * (1 + fillingRatio);
            const decayTime = 1 / Math.max(damping, 1e-6);
            const resonantFactor = 1 / Math.sqrt(Math.pow(1 - Math.pow(frequency / 0.8, 2), 2) + Math.pow(0.05 * frequency / 0.8, 2));
            return [force, energy, decayTime, resonantFactor, rollAngle * force];
          },
        };
        const fn = fnMap[fnKey] || fnMap.sloshingDynamics;
        const result = computeJacobian(fn, x, eps || 1e-6);
        return { id: task.id, success: true, data: { jacobian: result }, computeTimeMs: performance.now() - start };
      }
      case 'gzCurve': {
        const result = computeGZCurve(task.payload as GzCurveParams);
        return { id: task.id, success: true, data: result, computeTimeMs: performance.now() - start };
      }
      case 'stabilitySensitivity': {
        const { gzParams, perturbations } = task.payload;
        const result = computeStabilitySensitivity(gzParams, perturbations);
        return { id: task.id, success: true, data: { sensitivities: result }, computeTimeMs: performance.now() - start };
      }
      default:
        return { id: task.id, success: false, error: `Unknown task type: ${task.type}`, computeTimeMs: performance.now() - start };
    }
  } catch (e: any) {
    return { id: task.id, success: false, error: e.message || 'Unknown error', computeTimeMs: performance.now() - start };
  }
}

if (!isMainThread && parentPort) {
  parentPort.on('message', (task: MatrixTask) => {
    const result = handleTask(task);
    parentPort!.postMessage(result);
  });
}

export { moorePenrosePseudoinverse, gaussianEliminationSolve, computeJacobian, computeGZCurve, computeStabilitySensitivity };
