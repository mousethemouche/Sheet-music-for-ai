// The Vercel Function of the MCP server (docs/deploy/VERCEL.md). vercel.json
// rewrites every path the static output does not hold here. The handler is the
// bundled adapter api/_serverless.ts, built into dist/server/serverless.js by
// the project's build command before Vercel traces this file.
export { default } from '../dist/server/serverless.js';
