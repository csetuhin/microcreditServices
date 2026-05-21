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

export class CustomerRepository implements ICustomerRepository {

  async checkBranchEODStatus(brCode: string): Promise<{ isClosed: boolean, operationDate: Date | null }> {
    try {
      const pool = await Database.getConnection();
      const query = `SELECT TOP 1 
                      LBrCode, 
                      DyfDate AS OperationDate, 
                      DayEndFlag
                      FROM D010007 
                      WHERE LBrCode = @brCode 
                      ORDER BY DyfDate DESC;`;
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
      
      const query = `
                    SELECT TOP 1 1
                    FROM D009040 a
                    WHERE a.LBrCode = @brCode
                    AND a.EntryDate = @opDate 
                    AND a.MainAcctId LIKE '________' + @paddedCustNo + '%'
                    AND a.CanceledFlag <> 'C';
      `;
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
      
      const query = `
                    SELECT 
                        a.CustNo
                    FROM D009015 a
                    INNER JOIN D009011 b ON a.CustNo = b.CustNo
                    INNER JOIN D010014 c ON b.LBrCode = c.LBrCode 
                        AND SUBSTRING(c.PrdAcctId, 9, 8) = a.CustNo
                        AND c.CblDate = (SELECT MAX(CblDate) FROM D010014 WHERE LBrCode = c.LBrCode AND PrdAcctId = c.PrdAcctId)
                    WHERE a.CustStatus = 1 
                        AND b.LBrCode = @brCode
                        GROUP BY a.CustNo
                        HAVING SUM(ABS(c.Balance1)) + SUM(ABS(c.Balance4)) + SUM(ABS(c.Balance13)) = 0;
      `;

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
      
      const query = `
        -- Fetch Savings
        SELECT 'SAVINGS' as type, a.PrdAcctId as accountNo, a.AcctStat as status, a.ShdClrBalFcy as balance, 0 as penalPaidFcy, 0 as penalPrvdFcy, 0 as totalCredit 
        FROM D009022 a 
        INNER JOIN D009021 b ON a.LBrCode = b.LBrCode AND a.PrdAcctId LIKE b.PrdCd + '%'
        WHERE a.CustNo = @custNo AND a.AcctStat IN (1,2) AND b.ModuleType = 11
        
        UNION ALL
        
        -- Fetch Loan
        SELECT 'LOAN' as type, a.PrdAcctId as accountNo, a.AcctStat as status, b.MainBalFcy as balance, b.PenalPaidFcy as penalPaidFcy, b.PenalPrvdFcy as penalPrvdFcy, b.TotalCredit as totalCredit
        FROM D009022 a 
        INNER JOIN D030003 b ON a.LBrCode = b.LBrCode AND a.PrdAcctId = b.PrdAcctId 
        WHERE a.CustNo = @custNo AND a.AcctStat IN (1,2)
        
        UNION ALL
        
        -- Fetch Term Deposit
        SELECT 'TERM_DEPOSIT' as type, PrdAcctId as accountNo, ReceiptStatus as status, MainBalFcy as balance, 0 as penalPaidFcy, 0 as penalPrvdFcy, 0 as totalCredit 
        FROM D020004 
        WHERE LBrCode = @brCode AND PrdAcctId LIKE '________' + RIGHT('00000000' + CAST(@custNo AS VARCHAR), 8) + '%' AND ReceiptStatus != 99;
      `;

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
      const query = `
        SELECT SUM(CASE WHEN DrCr = 'D' THEN FcyTrnAmt ELSE -FcyTrnAmt END) AS CalculatedBalance
        FROM MFPRPLDB.dbo.VD009040
        WHERE LBrCode = @brCode AND VcrAcctId = @prdAcctId AND CanceledFlag <> 'C'
      `;
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
      const query = `
        SELECT SUM(CASE WHEN DrCr = 'D' THEN FcyTrnAmt ELSE -FcyTrnAmt END) AS CalculatedBalance
        FROM MFPRPLDB.dbo.VD009040
        WHERE LBrCode = @brCode AND MainAcctId = @prdAcctId AND VcrAcctId LIKE '94%' AND CanceledFlag <> 'C'
      `;
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
      const query = `
        SELECT SUM(CASE WHEN DrCr = 'D' THEN FcyTrnAmt ELSE -FcyTrnAmt END) AS CalculatedBalance
        FROM MFPRPLDB.dbo.VD009040
        WHERE LBrCode = @brCode AND VcrAcctId = @prdAcctId AND CanceledFlag <> 'C'
      `;
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
      const query = `
        SELECT SUM(CASE WHEN DrCr = 'D' THEN FcyTrnAmt ELSE -FcyTrnAmt END) AS CalculatedBalance
        FROM MFPRPLDB.dbo.VD009040
        WHERE LBrCode = @brCode AND VcrAcctId = @prdAcctId AND CanceledFlag <> 'C'
      `;
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
              .query(`UPDATE dbo.D030003 SET MainBalFcy = 0, MainBalLcy = 0, TotalCredit = 0, DbtrUpdtChkId = DbtrUpdtChkId + 1 WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;`);
            
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(`UPDATE dbo.D009022 SET ShdClrBalFcy = 0, ShdTotBalFcy = 0, ActClrBalFcy = 0, ActTotBalFcy = 0, ActTotBalLcy = 0, AcctStat = 3, DateClosed = @operationDate, ClosedUser = '11', SplInstr2 = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;`);
          } else {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(`UPDATE dbo.D009022 SET AcctStat = 3, DateClosed = @operationDate, ClosedUser = '11', SplInstr2 = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;`);
          }
        } 
        else if (acc.type === 'SAVINGS') {
          if (acc.zeroOutBalance) {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(`UPDATE dbo.D009022 SET ShdClrBalFcy = 0, ShdTotBalFcy = 0, ActClrBalFcy = 0, ActTotBalFcy = 0, ActTotBalLcy = 0, AcctStat = 3, DateClosed = @operationDate, ClosedUser = '11', SplInstr2 = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;`);
          } else {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(`UPDATE dbo.D009022 SET AcctStat = 3, DateClosed = @operationDate, ClosedUser = '11', SplInstr2 = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;`);
          }
        } 
        else if (acc.type === 'TERM_DEPOSIT') {
          if (acc.zeroOutBalance) {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(`UPDATE dbo.D020004 SET MainBalFcy = 0, MainBalLcy = 0, ReceiptStatus = 99, ClosedDate = @operationDate, Remarks = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;`);
          } else {
            await transaction.request()
              .input('brCode', sql.VarChar, brCode).input('prdAcctId', sql.VarChar, prdAcctId)
              .input('operationDate', sql.DateTime, command.operationDate).input('msg', sql.VarChar, closeMessage)
              .query(`UPDATE dbo.D020004 SET ReceiptStatus = 99, ClosedDate = @operationDate, Remarks = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;`);
          }
        }

        logger.debug(`Closed ${acc.type} account: ${acc.accountNo}`, { context: 'CustomerRepository' });
      }

      for (const anomaly of command.anomaliesToLog) {
        // TODO: Implementation of anomaly logging into Anomaly_Logs
        logger.warn(`Anomaly detected: ${anomaly.accountNo}`, { context: 'CustomerRepository', anomaly });
      }

      await transaction.request()
        .input('custNo', sql.VarChar, String(command.custNo))
        .input('operationDate', sql.DateTime, command.operationDate)
        .query(`
          UPDATE dbo.D009015
          SET CustStatus = 2,
              DropOutDate = @operationDate,
              DropOutDoneBy = 11,
              DbtrUpdtChkId = DbtrUpdtChkId + 1
          WHERE CustNo = @custNo;
        `);

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
      const query = `
        WITH ActiveBranches AS (
            SELECT BrCode FROM BranchList WHERE BrCode >= 111001 AND PCode IN (2,3) AND BranchStatus = 1
        )
        MERGE dbo.BranchDropoutTracker AS Target
        USING ActiveBranches AS Source
        ON (Target.BrCode = Source.BrCode)
        WHEN MATCHED THEN 
            UPDATE SET IsActive = 1
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (BrCode, IsActive, LastExecutionTime, NoOfExecution, NoOfDropout)
            VALUES (Source.BrCode, 1, NULL, 0, 0)
        WHEN NOT MATCHED BY SOURCE THEN
            UPDATE SET IsActive = 0;
      `;
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
      const query = `SELECT BrCode FROM dbo.BranchDropoutTracker WHERE IsActive = 1`;
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
      const query = `
        UPDATE dbo.BranchDropoutTracker 
        SET LastExecutionTime = GETDATE(),
            NoOfExecution = NoOfExecution + 1,
            NoOfDropout = NoOfDropout + @dropoutCount
        WHERE BrCode = @brCode;
      `;
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
      const query = `
        INSERT INTO Process_Log_Success (brCode, custNo, closedAccountsInfo, timestamp)
        VALUES (@brCode, @custNo, @info, @timestamp)
      `;
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
      const query = `
        INSERT INTO Process_Log_Error (brCode, custNo, failedStep, errorReason, timestamp)
        VALUES (@brCode, @custNo, @step, @reason, @timestamp)
      `;
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
