/**
 * Vercel entry point: every /api/* request is rewritten here (see vercel.json) and handled by the
 * same Express app the local server runs. Environment variables come from the Vercel project.
 */
import { createApp } from '../server/app.js';

const { app } = createApp();

export default app;
