import type { CourseShotInput } from '../../src/lib/gspro/course'

export declare const VERSION: string
export declare function parseArgs(argv: string[]): Record<string, string | true>
export declare function hostPort(value: string, fallbackHost: string): { host: string; port: number }
export declare function jsonSplitter(onMessage: (message: Record<string, unknown>) => void): (chunk: string) => void
export declare function roundKeyOf(rows: unknown[]): string
export declare function courseShotsFromRound(rows: unknown[], seenAt: number): CourseShotInput[]
export declare function parseBag(text: string): { name: string; loft: number }[]
export declare function startupScript(nodePath: string, scriptPath: string): string
