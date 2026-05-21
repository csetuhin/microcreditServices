import { ICustomerRepository } from '../ports/ICustomerRepository.js';
import { DropoutProcessService } from './DropoutProcessService.js';
import { logger } from '../../infrastructure/logger.js';

export class BatchDropoutOrchestrator {
  constructor(
    private customerRepo: ICustomerRepository,
    private dropoutService: DropoutProcessService
  ) {}

  async runNightlyDropoutProcess(): Promise<void> {
    logger.info('Starting Nightly Multi-Branch Dropout Job...', { context: 'BatchDropoutOrchestrator' });
    try {
      // Step 1: Sync Tracking Table
      await this.customerRepo.syncBranchTracker();
      logger.info('Branch execution tracker synchronized successfully.', { context: 'BatchDropoutOrchestrator' });

      // Step 2: Fetch Active Branches
      const branches = await this.customerRepo.getActiveBranchesFromTracker();
      logger.info(`Found ${branches.length} active branches to process.`, { context: 'BatchDropoutOrchestrator' });

      // Step 3: Loop and Process with Error Isolation
      for (const brCode of branches) {
        const brCodeStr = String(brCode);
        try {
          // Execute individual branch dropout
          const dropoutCount = await this.dropoutService.processDropoutForBranch(brCodeStr);
          
          // Update stats in the tracker table
          await this.customerRepo.updateBranchTrackerStats(brCodeStr, dropoutCount);
          logger.info(`Branch ${brCodeStr} processed. Dropouts: ${dropoutCount}`, { context: 'BatchDropoutOrchestrator' });
        } catch (branchError) {
          logger.error(`Failed to process branch ${brCodeStr}. Skipping to next branch.`, { 
            context: 'BatchDropoutOrchestrator', 
            error: branchError instanceof Error ? branchError.message : String(branchError) 
          });
        }
      }
      logger.info('Nightly Multi-Branch Dropout Job Completed.', { context: 'BatchDropoutOrchestrator' });
    } catch (error) {
      logger.error('Critical failure in Batch Dropout Orchestrator', { 
        context: 'BatchDropoutOrchestrator', 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
}
