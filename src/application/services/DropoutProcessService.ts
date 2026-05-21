import { ICustomerRepository } from '../../application/ports/ICustomerRepository.js';
import { BatchDropoutCommand } from '../../domain/models.js';
import { logger } from '../../infrastructure/logger.js';

export class DropoutProcessService {
  private customerRepo: ICustomerRepository;

  constructor(customerRepo: ICustomerRepository) {
    this.customerRepo = customerRepo;
  }

  /**
   * Orchestrates the dropout process for all eligible customers in a specific branch.
   * Returns the total number of successfully processed dropouts.
   */
  async processDropoutForBranch(brCode: string): Promise<number> {
    logger.info(`Starting dropout process for branch: ${brCode}`, { context: 'DropoutProcessService' });
    let branchDropoutCount = 0;

    try {
      // Step 1: Check EOD Status
      const eodStatus = await this.customerRepo.checkBranchEODStatus(brCode);
      const isBranchClosed = eodStatus.isClosed;
      const opDate = eodStatus.operationDate;

      logger.info(`Branch ${brCode} Status: ${isBranchClosed ? 'CLOSED (Skipping Txn Check)' : 'OPEN (Will check Txns)'}`, { context: 'DropoutProcessService' });

      if (!opDate) {
        logger.warn(`Skipping Branch ${brCode}. Operation date not found.`);
        return 0;
      }

      // Step 2: Fetch Eligible Customers
      const eligibleCustomers = await this.customerRepo.getEligibleCustomersForDropout(brCode);
      logger.info(`Found ${eligibleCustomers.length} eligible customers for branch ${brCode}`, { context: 'DropoutProcessService' });

      for (const customer of eligibleCustomers) {
        try {
          logger.debug(`Evaluating Customer: ${customer.custNo}`, { context: 'DropoutProcessService' });

          // Step 3: Transaction Check (ONLY IF BRANCH IS OPEN)
          if (!isBranchClosed) {
            const hasTxn = await this.customerRepo.hasTransactionToday(customer.custNo, brCode, opDate);
            if (hasTxn) {
              logger.debug(`Skipping Customer ${customer.custNo}: Branch is open and has transaction today.`, { context: 'DropoutProcessService' });
              continue; 
            }
          }

          // Step 4: Fetch detailed account state
          const accountState = await this.customerRepo.getCustomerAccountsState(customer.custNo, brCode);
          
          let isValidForDropout = true;
          const command: BatchDropoutCommand = {
            custNo: customer.custNo,
            brCode: brCode,
            operationDate: opDate,
            accountsToClose: [],
            anomaliesToLog: []
          };

          // Step 5: Loan Validation (Fail-fast)
          for (const loan of accountState.loans) {
            logger.debug(`Validating Loan Account: ${loan.accountNo}`, { context: 'DropoutProcessService' });

            // Rule 5.1: Penal Paid must match Penal Provided
            if (loan.penalPaidFcy !== loan.penalPrvdFcy) {
              const reason = `Penal mismatch on Loan ${loan.accountNo} (Paid: ${loan.penalPaidFcy}, Prvd: ${loan.penalPrvdFcy})`;
              logger.warn(`Skipping Customer ${customer.custNo}: ${reason}`, { context: 'DropoutProcessService' });
              
              await this.customerRepo.logError({
                brCode,
                custNo: customer.custNo,
                failedStep: 'LOAN_VALIDATION',
                errorReason: reason,
                timestamp: new Date()
              });

              isValidForDropout = false;
              break;
            }

            let zeroOutBalance = false;

            // Rule 5.2: Balance Check & Recalculation
            if (loan.balance !== 0) {
              const calculatedBalance = await this.customerRepo.recalculateLoanBalance(brCode, loan.accountNo);
              if (calculatedBalance !== 0) {
                const reason = `Non-zero calculated balance on Loan ${loan.accountNo} (${calculatedBalance})`;
                logger.warn(`Skipping Customer ${customer.custNo}: ${reason}`, { context: 'DropoutProcessService' });
                
                await this.customerRepo.logError({
                  brCode,
                  custNo: customer.custNo,
                  failedStep: 'LOAN_VALIDATION',
                  errorReason: reason,
                  timestamp: new Date()
                });

                isValidForDropout = false;
                break;
              }
              zeroOutBalance = true;
            }

            // Rule 5.3: Total Credit Check & Recalculation
            if (loan.totalCredit !== 0) {
              const calculatedCredit = await this.customerRepo.recalculateLoanCredit(brCode, loan.accountNo);
              if (calculatedCredit !== 0) {
                const reason = `Non-zero calculated credit on Loan ${loan.accountNo} (${calculatedCredit})`;
                logger.warn(`Skipping Customer ${customer.custNo}: ${reason}`, { context: 'DropoutProcessService' });
                
                await this.customerRepo.logError({
                  brCode,
                  custNo: customer.custNo,
                  failedStep: 'LOAN_VALIDATION',
                  errorReason: reason,
                  timestamp: new Date()
                });

                isValidForDropout = false;
                break;
              }
              zeroOutBalance = true;
            }

            if (zeroOutBalance) {
              command.anomaliesToLog.push({
                custNo: customer.custNo,
                accountType: 'LOAN',
                accountNo: loan.accountNo,
                lingeringBalance: loan.balance || loan.totalCredit,
                timestamp: new Date()
              });
            }

            command.accountsToClose.push({
              type: 'LOAN',
              accountNo: loan.accountNo,
              zeroOutBalance
            });
          }

          if (!isValidForDropout) continue;

          // Step 6: Term Deposit Validation (Fail-fast)
          for (const td of accountState.termDeposits) {
            logger.debug(`Validating Term Deposit: ${td.accountNo}`, { context: 'DropoutProcessService' });

            let zeroOutBalance = false;

            if (td.balance !== 0) {
              const calculatedBalance = await this.customerRepo.recalculateTermDepositBalance(brCode, td.accountNo);
              if (calculatedBalance !== 0) {
                const reason = `Non-zero calculated TD balance on account ${td.accountNo} (${calculatedBalance})`;
                logger.warn(`Skipping Customer ${customer.custNo}: ${reason}`, { context: 'DropoutProcessService' });
                
                await this.customerRepo.logError({
                  brCode,
                  custNo: customer.custNo,
                  failedStep: 'TD_VALIDATION',
                  errorReason: reason,
                  timestamp: new Date()
                });

                isValidForDropout = false;
                break;
              }
              zeroOutBalance = true;
            }

            if (zeroOutBalance) {
              command.anomaliesToLog.push({
                custNo: customer.custNo,
                accountType: 'TERM_DEPOSIT',
                accountNo: td.accountNo,
                lingeringBalance: td.balance,
                timestamp: new Date()
              });
            }

            command.accountsToClose.push({
              type: 'TERM_DEPOSIT',
              accountNo: td.accountNo,
              zeroOutBalance
            });
          }

          if (!isValidForDropout) continue;

          // Step 7: Savings Validation (Fail-fast)
          for (const savings of accountState.savings) {
            logger.debug(`Validating Savings Account: ${savings.accountNo}`, { context: 'DropoutProcessService' });

            let zeroOutBalance = false;

            if (savings.balance !== 0) {
              const calculatedBalance = await this.customerRepo.recalculateSavingsBalance(brCode, savings.accountNo);
              if (calculatedBalance !== 0) {
                const reason = `Non-zero calculated Savings balance on account ${savings.accountNo} (${calculatedBalance})`;
                logger.warn(`Skipping Customer ${customer.custNo}: ${reason}`, { context: 'DropoutProcessService' });
                
                await this.customerRepo.logError({
                  brCode,
                  custNo: customer.custNo,
                  failedStep: 'SAVINGS_VALIDATION',
                  errorReason: reason,
                  timestamp: new Date()
                });

                isValidForDropout = false;
                break;
              }
              zeroOutBalance = true;
            }

            if (zeroOutBalance) {
              command.anomaliesToLog.push({
                custNo: customer.custNo,
                accountType: 'SAVINGS',
                accountNo: savings.accountNo,
                lingeringBalance: savings.balance,
                timestamp: new Date()
              });
            }

            command.accountsToClose.push({
              type: 'SAVINGS',
              accountNo: savings.accountNo,
              zeroOutBalance
            });
          }

          if (!isValidForDropout) continue;

          // Step 8: Execution
          await this.customerRepo.executeBatchDropoutTransaction(command);
          branchDropoutCount++;

          // Step 9: Log Success
          await this.customerRepo.logSuccess({
            brCode,
            custNo: customer.custNo,
            closedAccountsInfo: JSON.stringify(command.accountsToClose),
            timestamp: new Date()
          });

        } catch (innerError) {
          const reason = innerError instanceof Error ? innerError.message : String(innerError);
          logger.error(`Error processing customer ${customer.custNo} in branch ${brCode}. skipping.`, { 
            context: 'DropoutProcessService', 
            error: reason
          });
          
          await this.customerRepo.logError({
            brCode,
            custNo: customer.custNo,
            failedStep: 'BATCH_EXECUTION',
            errorReason: reason,
            timestamp: new Date()
          });

          continue;
        }
      }

      logger.info(`Finished dropout process for branch: ${brCode}. Total Dropouts: ${branchDropoutCount}`, { context: 'DropoutProcessService' });
      return branchDropoutCount;

    } catch (error) {
      logger.error(`Critical failure in dropout process for branch ${brCode}`, { context: 'DropoutProcessService', error });
      return 0;
    }
  }
}
