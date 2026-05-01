/**
 * harness/contracts —— 控制平面的契约总入口。
 *
 * 这里集中 re-export 三个 schema 文件的所有公开符号，让 src/ 端的
 * 引用点保持稳定：
 *
 *     import { IntentSpec, Plan, EvaluationResult } from "@harness/contracts"
 *
 * 不要在 src/ 里重新声明这些类型——以本目录的 Zod schema 为唯一来源。
 */

export * from "./intent.schema.js"
export * from "./plan.schema.js"
export * from "./evaluation.schema.js"
