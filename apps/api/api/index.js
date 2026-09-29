// The Vercel Function of apps/api (docs/deploy/VERCEL.md). vercel.json rewrites
// every path here. The handler is the bundled adapter api/_serverless.ts, built
// into dist/serverless.js by the project's build command before Vercel traces
// this file.
export { default } from '../dist/serverless.js';
