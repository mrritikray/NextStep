/**
 * Re-export of the shared service types so AI modules can import from a single
 * relative path without reaching into ../services/types.
 */
export type * from "./types";
export type { MatchResult } from "./matching";
export type AnalysisResultEngine = "gemini" | "rules" | "demo";
