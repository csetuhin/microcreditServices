import { Request, Response } from 'express';
import { DropoutProcessService } from '../../application/services/DropoutProcessService.js';
import { BatchDropoutOrchestrator } from '../../application/services/BatchDropoutOrchestrator.js';
import { CustomerRepository } from '../../infrastructure/adapters/CustomerRepository.js';
import { logger } from '../../infrastructure/logger.js';

export class DropoutController {
  private dropoutService: DropoutProcessService;
  private customerRepo: CustomerRepository;
  private orchestrator: BatchDropoutOrchestrator;

  constructor() {
    this.customerRepo = new CustomerRepository();
    this.dropoutService = new DropoutProcessService(this.customerRepo);
    this.orchestrator = new BatchDropoutOrchestrator(this.customerRepo, this.dropoutService);
  }

  /**
   * Triggers dropout for all active branches.
   */
  public handleAllDropouts = async (_req: Request, res: Response): Promise<void> => {
    try {
      // Execute multi-branch process (Fire and forget if it's too long, or await)
      // Since it's a critical job, we'll run it in background and return accepted
      this.orchestrator.runNightlyDropoutProcess()
        .catch(err => logger.error('Manual batch dropout failed', { error: err }));

      res.status(202).json({
        success: true,
        message: 'Manual multi-branch dropout process started in the background.',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to initiate manual batch dropout', { error });
      res.status(500).json({ error: 'Failed to start batch process' });
    }
  };

  /**
   * Triggers dropout for a specific branch.
   */
  public handleDropout = async (req: Request, res: Response): Promise<void> => {
    const { brCode } = req.params;

    if (!brCode) {
      res.status(400).json({ error: 'Branch code is required' });
      return;
    }

    try {
      // 1. Run the process for the specific branch
      const dropoutCount = await this.dropoutService.processDropoutForBranch(brCode);

      // 2. Track the manual run in the tracking table
      await this.customerRepo.updateBranchTrackerStats(brCode, dropoutCount);

      // 3. Return the result synchronously
      res.status(200).json({
        success: true,
        message: `Branch ${brCode} processed successfully. Total dropouts: ${dropoutCount}`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`API Error for branch ${brCode}`, { context: 'DropoutController', error: reason });
      res.status(500).json({ error: 'Failed to process branch' });
    }
  };
}
