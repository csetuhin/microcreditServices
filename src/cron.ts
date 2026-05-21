import { Database } from './infrastructure/database.js';
import { CustomerRepository } from './infrastructure/adapters/CustomerRepository.js';
import { DropoutProcessService } from './application/services/DropoutProcessService.js';
import { BatchDropoutOrchestrator } from './application/services/BatchDropoutOrchestrator.js';
import { logger } from './infrastructure/logger.js';

async function startNightlyBatch() {
  try {
    logger.info('Initializing Standalone Nightly Batch Process...', { context: 'CronEntry' });

    // 1. Initialize dependencies
    const customerRepo = new CustomerRepository();
    const dropoutService = new DropoutProcessService(customerRepo);
    const orchestrator = new BatchDropoutOrchestrator(customerRepo, dropoutService);

    // 2. Execute the multi-branch orchestrator
    await orchestrator.runNightlyDropoutProcess();

  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('Fatal error during nightly batch execution', { context: 'CronEntry', error: reason });
  } finally {
    // 3. Gracefully close database connections to prevent hanging processes
    logger.info('Closing database connections and exiting...', { context: 'CronEntry' });
    await Database.closeAll();
    process.exit(0);
  }
}

// Execute the job
startNightlyBatch();
