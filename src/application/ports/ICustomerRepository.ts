import { 
  EligibleCustomer, 
  ProcessLogSuccess, 
  ProcessLogError,
  CustomerAccountsState,
  BatchDropoutCommand
} from '../../domain/models.js';

export interface ICustomerRepository {
  /**
   * Checks if the End of Day (EOD) process has been completed for the given branch.
   * Returns the closure status and the operation date.
   */
  checkBranchEODStatus(brCode: string): Promise<{ isClosed: boolean, operationDate: Date | null }>;

  /**
   * Checks if a specific customer has had any transactions today.
   */
  hasTransactionToday(custNo: string, brCode: string, operationDate: Date): Promise<boolean>;

  /**
   * Retrieves a list of customers eligible for dropout processing based on branch code.
   * Based on D010014 (Single Source of Truth) where balance is already verified as 0.
   */
  getEligibleCustomersForDropout(brCode: string): Promise<EligibleCustomer[]>;

  /**
   * Fetches the complete state of all accounts associated with a customer.
   */
  getCustomerAccountsState(custNo: string, brCode: string): Promise<CustomerAccountsState>;

  /**
   * Recalculates the actual balance of a loan account from the transaction history.
   */
  recalculateLoanBalance(brCode: string, prdAcctId: string): Promise<number>;

  /**
   * Recalculates the total credit of a loan account from the transaction history.
   */
  recalculateLoanCredit(brCode: string, prdAcctId: string): Promise<number>;

  /**
   * Recalculates the actual balance of a savings account from the transaction history.
   */
  recalculateSavingsBalance(brCode: string, prdAcctId: string): Promise<number>;

  /**
   * Recalculates the actual balance of a term deposit account from the transaction history.
   */
  recalculateTermDepositBalance(brCode: string, prdAcctId: string): Promise<number>;

  /**
   * Executes a batch of dropout-related operations (closing accounts, zeroing balances,
   * logging anomalies, and marking customer as dropout) in a single atomic transaction.
   */
  executeBatchDropoutTransaction(command: BatchDropoutCommand): Promise<void>;

  /**
   * Synchronizes the BranchDropoutTracker table with the master BranchList.
   */
  syncBranchTracker(): Promise<void>;

  /**
   * Retrieves a list of active branch codes from the tracker.
   */
  getActiveBranchesFromTracker(): Promise<number[]>;

  /**
   * Updates execution statistics for a specific branch in the tracker.
   */
  updateBranchTrackerStats(brCode: string, dropoutCount: number): Promise<void>;

  /**
   * Logs a successful processing event for a customer.
   */
  logSuccess(log: ProcessLogSuccess): Promise<void>;

  /**
   * Logs a failed processing event for a customer.
   */
  logError(log: ProcessLogError): Promise<void>;
}
