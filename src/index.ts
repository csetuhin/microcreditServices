import express from 'express';
import dotenv from 'dotenv';
import apiRoutes from './presentation/routes.js';
import { NightlyJob } from './presentation/cron/NightlyJob.js';
import { Database } from './infrastructure/database.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/api/v1', apiRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

async function bootstrap() {
  try {
    // 1. Initialize DB Connection Pool
    await Database.getConnection();

    // 2. Start Cron Jobs
    NightlyJob.start();

    // 3. Start Express Server
    app.listen(port, () => {
      console.log(`[Server] Core Banking System running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('[Bootstrap] Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();
