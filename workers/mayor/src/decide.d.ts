// Type declarations for ./decide.js (vendored shared decision-model helper).
// Canonical source: mehyar-us/mehyar-web, functions/api/_shared/decide.js

export type DecideQuestionType = "noul" | "choice" | "score";
export interface DecideQuestion {
  type: DecideQuestionType;
  ask: string;
  options?: Record<string, string>;
  levels?: string[];
}
export interface DecideAnswer {
  id: string;
  type: DecideQuestionType | "unknown";
  ok: boolean;
  decision?: boolean | string | number;
  confidence?: number;
  probabilities?: Record<string, number>;
  p?: number;
  rawScore?: number;
  levels?: number;
  legend?: Record<string, string>;
  error?: string;
  raw?: unknown;
}
export interface DecideUsage { input_tokens: number; output_tokens: number }
export interface DecideResult {
  ok: boolean;
  answers: Record<string, DecideAnswer>;
  model: string;
  latency_ms: number;
  usage: DecideUsage;
  via: string | null;
  error?: string;
  fallback?: boolean;
}
export interface DecideOpts {
  modelShort?: string;
  timeoutMs?: number;
  transport?: (env: any, wireBody: any, opts?: any) => Promise<{ raw: any; latencyMs: number; via: string }>;
  audit?: (entry: any) => void | Promise<void>;
  tag?: string;
}
export declare function decide(env: any, state: unknown, questions: Record<string, DecideQuestion>, opts?: DecideOpts): Promise<DecideResult>;
export declare function verdict(answer: DecideAnswer | null | undefined, thresholds?: { autoAt?: number; reviewAt?: number }): "auto" | "review" | "fail";
export declare const DECIDE_THRESHOLDS: Record<string, { autoAt: number; reviewAt: number }>;
export declare const DECIDE_MODEL: string;
export declare const DECIDE_MODEL_SHORT: string;
export declare const DECIDE_MAX_QUESTIONS: number;
export declare function stateParts(text: string, imageUrls?: string[]): Array<{ type: string; text?: string; image_url?: { url: string } }>;
