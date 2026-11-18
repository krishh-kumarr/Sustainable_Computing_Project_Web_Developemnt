// Vercel serverless entry: reuses the local proxy's request handler.
export { handler as default } from '../server/index.mjs'
export const config = { maxDuration: 90 }
