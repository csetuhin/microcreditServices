import sql from 'mssql';
import { ICustomerRepository } from '../../application/ports/ICustomerRepository.js';
import { 
  EligibleCustomer, 
  ProcessLogSuccess, 
  ProcessLogError,
  CustomerAccountsState,
  BatchDropoutCommand,
  AccountState
} from '../../domain/models.js';
import { Database } from '../database.js';
import { logger } from '../logger.js';
import { DropoutQueries } from '../database/queries/DropoutQueries.js';

export class CustomerRepository implements ICustomerRepository {

  async checkBranchEODStatus(brCode: string): Promise<{ isClosed: boolean, operationDate: Date | null }> {
    try {
      const pool = await Database.getConnection();
      const query = DropoutQueries.CHECK_EOD_STATUS;
      const result = await pool.request()
        .input('brCode', sql.VarChar, String(brCode))
        .query(query);
      
      if (result.recordset.length > 0) {
        const row = result.recordset[0];
        // DayEndFlag: 1 = Closed, 0 = Open
        return {
          isClosed: row.DayEndFlag === 1,
          operationDate: row.OperationDate
        };
      }
      return { isClosed: false, operationDate: null };
    } catch (error) {
      logger.error(`Error in checkBranchEODStatus for branch ${brCode}`, { context: 'CustomerRepository', error });
      return { isClosed: false, operationDate: null };
    }
  }

  async hasTransactionToday(custNo: string, brCode: string, operationDate: Date): Promise<boolean> {
    try {
      const pool = await Database.getConnection();
      
      // Pad to 8 digits in Node.js to reduce SQL overhead
      const paddedCustNo = String(custNo).padStart(8, '0');
      
      const query = DropoutQueries.HAS_TRANSACTION_TODAY;
      const result = await pool.request()
        .input('brCode', sql.VarChar, String(brCode))
        .input('opDate', sql.DateTime, operationDate)
        .input('paddedCustNo', sql.VarChar, paddedCustNo)
        .query(query);
      
      return result.recordset.length > 0;
    } catch (error) {
      logger.error(`Error in hasTransactionToday for customer ${custNo}`, { context: 'CustomerRepository', error });
      return true; // Safety first: assume transaction exists if check fails
    }
  }
  
  async getEligibleCustomersForDropout(brCode: string): Promise<EligibleCustomer[]> {
    try {
      const pool = await Database.getConnection();
      
      const query = DropoutQueries.GET_ELIGIBLE_CUSTOMERS;

      const result = await pool.request()
        .input('brCode', sql.VarChar, String(brCode))
        .query(query);

      return result.recordset.map(row => ({
        custNo: row.CustNo,
        brCode: brCode,
        totalBalance: 0
      }));
    } catch (error) {
      logger.error(`Error in getEligibleCustomersForDropout for branch ${brCode}`, { context: 'CustomerRepository', error });
      throw new Error('Failed to fetch eligible customers');
    }
  }

  async getCustomerAccountsState(custNo: string, brCode: string): Promise<CustomerAccountsState> {
    try {
      const pool = await Database.getConnection();
      
      const query = DropoutQueries.GET_ACCOUNT_STATE;

      const result = await pool.request()
        .input('custNo', sql.VarChar, String(custNo))
        .input('brCode', sql.VarChar, String(brCode))
        .query(query);

      const accounts = result.recordset;
      
      return {
        savings: accounts.filter(a => a.type === 'SAVINGS').map(this.mapToAccountState),
        termDeposits: accounts.filter(a => a.type === 'TERM_DEPOSIT').map(this.mapToAccountState),
        loans: accounts.filter(a => a.type === 'LOAN').map(this.mapToAccountState)
      };
    } catch (error) {
      logger.error(`Error in getCustomerAccountsState for customer ${custNo}`, { context: 'CustomerRepository', error });
      throw new Error('Failed to fetch customer account state');
    }
  }

  private mapToAccountState(row: any): AccountState {
    return {
      type: row.type,
      accountNo: row.accountNo,
      status: row.status,
      balance: row.balance,
      penalPaidFcy: row.penalPaidFcy,
      penalPrvdFcy: row.penalPrvdFcy,
      totalCredit: row.totalCredit
    };
  }

  async recalculateLoanBalance(brCode: string, prdAcctId: string): Promise<number> {
    try {
      const pool = await Database.getHistoryConnection();
      const query = DropoutQueries.RECALCULATE_LOAN_BALANCE;
      const result = await pool.request()
        .input('brCode', sql.VarChar, String(brCode))
        .input('prdAcctId', sql.VarChar, String(prdAcctId))
        .query(query);
      return result.recordset[0]?.CalculatedBalance || 0;
    } catch (error) {
      logger.error(`Error recalculating loan balance for ${prdAcctId}`, { context: 'CustomerRepository', error });
      throw error;
    }
  }

  async recalculateLoanCredit(brCode: string, prdAcctId: string): Promise<number> {
    try {
      const pool = await Database.getHistoryConnection();
      const query = DropoutQueries.RECALCULATE_LOAN_CREDIT;
      const result = await pool.request()
        .input('brCode', sql.VarChar, String(brCode))
        .input('prdAcctId', sql.VarChar, String(prdAcctId))
        .query(query);
      return result.recordset[0]?.CalculatedBalance || 0;
    } catch (error) {
      logger.error(`Error recalculating loan credit for ${prdAcctId}`, { context: 'CustomerRepository', error });
      throw error;
    }
  }

  async recalculateSavingsBalance(brCode: string, prdAcctId: string): Promise<number> {
    try {
      const pool = await Database.getHistoryConnection();
      const query = DropoutQueries.RECALCULATE_SAVINGS_BALANCE;
      const result = await pool.request()
        .input('brCode', sql.VarChar, String(brCode))
        .input('prdAcctId', sql.VarChar, String(prdAcctId))
        .query(query);
      return result.recordset[0]?.CalculatedBalance || 0;
    } catch (error) {
      logger.error(`Error recalculating savings balance for ${prdAcctId}`, { context: 'CustomerRepository', error });
      throw error;
    }
  }

  async recalculateTermDepositBalance(brCode: string, prdAcctId: string): Promise<number> {
    try {
      const pool = await Database.getHistoryConnection();
      const query = DropoutQueries.RECALCULATE_TERM_DEPOSIT_BALANCE;
      const result = await pool.request()
        .input('brCode', sql.VarChar, String(brCode))
        .input('prdAcctId', sql.VarChar, String(prdAcctId))
        .query(query);
      return result.recordset[0]?.CalculatedBalance || 0;
    } catch (error) {
      logger.error(`Error recalculating term deposit balance for ${prdAcctId}`, { context: 'CustomerRepository', error });
      throw error;
    }
  }

  async executeBatchDropoutTransaction(command: BatchDropoutCommand): Promise<void> {
    if (process.env.DRY_RUN === 'true') {
      logger.info('DRY RUN EXECUTING BATCH:', { 
        context: 'CustomerRepository', 
        command: JSON.stringify(command) 
      });
      return;
    }

    const pool = await Database.getConnection();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const closeMessage = 'Account closed by auto account closure process';

      for (const acc of command.accountsToClose) {
        const brCode = String(command.brCode);
        const prdAcctId = String(acc.accountNo);

        if (acc.type === 'LOAN') {
          if (acc.zeroOutBalance) {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .query(DropoutQueries.BATCH_UPDATE_LOAN_D030003);
            
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(DropoutQueries.BATCH_UPDATE_D009022_ZERO_OUT);
          } else {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(DropoutQueries.BATCH_UPDATE_D009022_STATUS_ONLY);
          }
        } 
        else if (acc.type === 'SAVINGS') {
          if (acc.zeroOutBalance) {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(DropoutQueries.BATCH_UPDATE_D009022_ZERO_OUT);
          } else {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(DropoutQueries.BATCH_UPDATE_D009022_STATUS_ONLY);
          }
        } 
        else if (acc.type === 'TERM_DEPOSIT') {
          if (acc.zeroOutBalance) {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(DropoutQueries.BATCH_UPDATE_D020004_ZERO_OUT);
          } else {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(DropoutQueries.BATCH_UPDATE_D020004_STATUS_ONLY);
          }
        }

        logger.debug(`Closed ${acc.type} account: ${acc.accountNo}`, { context: 'CustomerRepository' });
      }

      for (const anomaly of command.anomaliesToLog) {
        await transaction.request()
          .input('custNo', sql.VarChar, String(anomaly.custNo))
          .input('accType', sql.VarChar, anomaly.accountType)
          .input('accNo', sql.VarChar, String(anomaly.accountNo))
          .input('balance', sql.Decimal(18, 2), anomaly.lingeringBalance)
          .input('timestamp', sql.DateTime, anomaly.timestamp)
          .query(DropoutQueries.LOG_ANOMALY);

        logger.warn(`Anomaly saved to DB: ${anomaly.accountNo}`, { context: 'CustomerRepository', anomaly });
      }

      await transaction.request()
        .input('custNo', sql.VarChar, String(command.custNo))
        .input('operationDate', sql.DateTime, command.operationDate)
        .query(DropoutQueries.UPDATE_CUSTOMER_DROPOUT);

      await transaction.commit();
    } catch (error) {
      if (transaction) await transaction.rollback();
      logger.error('Database batch transaction failed', { context: 'CustomerRepository', error, custNo: command.custNo });
      throw error;
    }
  }

  async syncBranchTracker(): Promise<void> {
    try {
      const pool = await Database.getConnection();
      const query = DropoutQueries.SYNC_BRANCH_TRACKER;
      await pool.request().query(query);
      logger.info('Branch tracker synchronized successfully.', { context: 'CustomerRepository' });
    } catch (error) {
      logger.error('Error synchronizing branch tracker', { context: 'CustomerRepository', error });
      throw error;
    }
  }

  async getActiveBranchesFromTracker(): Promise<number[]> {
    try {
      const pool = await Database.getConnection();
      const query = DropoutQueries.GET_ACTIVE_BRANCHES;
      const result = await pool.request().query(query);
      return result.recordset.map(row => row.BrCode);
    } catch (error) {
      logger.error('Error fetching active branches from tracker', { context: 'CustomerRepository', error });
      throw error;
    }
  }

  async updateBranchTrackerStats(brCode: string, dropoutCount: number): Promise<void> {
    try {
      const pool = await Database.getConnection();
      const query = DropoutQueries.UPDATE_BRANCH_STATS;
      await pool.request()
        .input('brCode', sql.VarChar, String(brCode))
        .input('dropoutCount', sql.Int, dropoutCount)
        .query(query);
    } catch (error) {
      logger.error(`Error updating tracker stats for branch ${brCode}`, { context: 'CustomerRepository', error });
    }
  }

  async logSuccess(log: ProcessLogSuccess): Promise<void> {
    try {
      const pool = await Database.getConnection();
      const query = DropoutQueries.LOG_SUCCESS;
      await pool.request()
        .input('brCode', sql.VarChar, String(log.brCode))
        .input('custNo', sql.VarChar, String(log.custNo))
        .input('info', sql.NVarChar, log.closedAccountsInfo)
        .input('timestamp', sql.DateTime, log.timestamp)
        .query(query);
    } catch (error) {
      logger.error('Error logging success', { context: 'CustomerRepository', error });
    }
  }

  async logError(log: ProcessLogError): Promise<void> {
    try {
      const pool = await Database.getConnection();
      const query = DropoutQueries.LOG_ERROR;
      await pool.request()
        .input('brCode', sql.VarChar, String(log.brCode))
        .input('custNo', sql.VarChar, String(log.custNo))
        .input('step', sql.VarChar, log.failedStep)
        .input('reason', sql.NVarChar, log.errorReason)
        .input('timestamp', sql.DateTime, log.timestamp)
        .query(query);
    } catch (error) {
      logger.error('Error logging error', { context: 'CustomerRepository', error });
    }
  }
}
