import dotenv from 'dotenv';
import { createApp } from './app.js';

dotenv.config();

const PORT = process.env.PORT || 8000;
const HOST = '0.0.0.0';

const { app } = createApp();

app.listen(PORT, HOST, () => {
  console.log(`Vireo server running on http://${HOST}:${PORT}`);
});
