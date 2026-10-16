/**
 * Minimal local typings for the `qrcode` package — only the SVG string
 * encoder the worker uses (connector-session QR codes). Declared locally
 * because @types/qrcode drags in @types/node, whose global timer types
 * conflict with the workers-types environment used across this codebase.
 */
declare module 'qrcode' {
  export function toString(
    text: string,
    options: { type: 'svg'; margin?: number; width?: number },
  ): Promise<string>;
}
