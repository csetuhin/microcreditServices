import cron from 'node-cron';
import { DropoutProcessService } from '../../application/services/DropoutProcessService.js';
import { CustomerRepository } from '../../infrastructure/adapters/CustomerRepository.js';

export class NightlyJob {
  public static start(): void {
    const customerRepo = new CustomerRepository();
    const dropoutService = new DropoutProcessService(customerRepo);

    // Schedule: Every night at 2:00 AM (0 2 * * *)
    cron.schedule('0 2 * * *', async () => {
      console.log('[Cron] Starting scheduled nightly dropout process...');
      
      // Example: List of branches to process. 
      // In production, this might be fetched from a Config table.
      const branchesToProcess = ['BR001', 'BR002', 'BR003'];

      for (const brCode of branchesToProcess) {
        try {
          await dropoutService.processDropoutForBranch(brCode);
        } catch (error) {
          console.error(`[Cron] Error processing branch ${brCode}:`, error);
        }
      }
      
      console.log('[Cron] Nightly dropout process completed.');
    });

    console.log('Nightly Cron Job scheduled for 2:00 AM.');
  }
}
