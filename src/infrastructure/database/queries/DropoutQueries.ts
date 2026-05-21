export const DropoutQueries = {
  CHECK_EOD_STATUS: `
    SELECT TOP 1 
      LBrCode, 
      DyfDate AS OperationDate, 
      DayEndFlag
    FROM D010007 
    WHERE LBrCode = @brCode 
    ORDER BY DyfDate DESC;
  `,

  HAS_TRANSACTION_TODAY: `
    SELECT TOP 1 1
    FROM D009040 a
    WHERE a.LBrCode = @brCode
    AND a.EntryDate = @opDate 
    AND a.MainAcctId LIKE '________' + @paddedCustNo + '%'
    AND a.CanceledFlag <> 'C';
  `,

  GET_ELIGIBLE_CUSTOMERS: `
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
  `,

  GET_ACCOUNT_STATE: `
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
  `,

  RECALCULATE_LOAN_BALANCE: `
    SELECT SUM(CASE WHEN DrCr = 'D' THEN FcyTrnAmt ELSE -FcyTrnAmt END) AS CalculatedBalance
    FROM MFPRPLDB.dbo.VD009040
    WHERE LBrCode = @brCode AND VcrAcctId = @prdAcctId AND CanceledFlag <> 'C'
  `,

  RECALCULATE_LOAN_CREDIT: `
    SELECT SUM(CASE WHEN DrCr = 'D' THEN FcyTrnAmt ELSE -FcyTrnAmt END) AS CalculatedBalance
    FROM MFPRPLDB.dbo.VD009040
    WHERE LBrCode = @brCode AND MainAcctId = @prdAcctId AND VcrAcctId LIKE '94%' AND CanceledFlag <> 'C'
  `,

  RECALCULATE_SAVINGS_BALANCE: `
    SELECT SUM(CASE WHEN DrCr = 'D' THEN FcyTrnAmt ELSE -FcyTrnAmt END) AS CalculatedBalance
    FROM MFPRPLDB.dbo.VD009040
    WHERE LBrCode = @brCode AND VcrAcctId = @prdAcctId AND CanceledFlag <> 'C'
  `,

  RECALCULATE_TERM_DEPOSIT_BALANCE: `
    SELECT SUM(CASE WHEN DrCr = 'D' THEN FcyTrnAmt ELSE -FcyTrnAmt END) AS CalculatedBalance
    FROM MFPRPLDB.dbo.VD009040
    WHERE LBrCode = @brCode AND VcrAcctId = @prdAcctId AND CanceledFlag <> 'C'
  `,

  BATCH_UPDATE_LOAN_D030003: `
    UPDATE dbo.D030003 
    SET MainBalFcy = 0, MainBalLcy = 0, TotalCredit = 0, DbtrUpdtChkId = DbtrUpdtChkId + 1 
    WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;
  `,

  BATCH_UPDATE_D009022_ZERO_OUT: `
    UPDATE dbo.D009022 
    SET ShdClrBalFcy = 0, ShdTotBalFcy = 0, ActClrBalFcy = 0, ActTotBalFcy = 0, ActTotBalLcy = 0, AcctStat = 3, DateClosed = @operationDate, ClosedUser = '11', SplInstr2 = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 
    WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;
  `,

  BATCH_UPDATE_D009022_STATUS_ONLY: `
    UPDATE dbo.D009022 
    SET AcctStat = 3, DateClosed = @operationDate, ClosedUser = '11', SplInstr2 = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 
    WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;
  `,

  BATCH_UPDATE_D020004_ZERO_OUT: `
    UPDATE dbo.D020004 
    SET MainBalFcy = 0, MainBalLcy = 0, ReceiptStatus = 99, ClosedDate = @operationDate, Remarks = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 
    WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;
  `,

  BATCH_UPDATE_D020004_STATUS_ONLY: `
    UPDATE dbo.D020004 
    SET ReceiptStatus = 99, ClosedDate = @operationDate, Remarks = @msg, DbtrUpdtChkId = DbtrUpdtChkId + 1 
    WHERE LBrCode = @brCode AND PrdAcctId = @prdAcctId;
  `,

  UPDATE_CUSTOMER_DROPOUT: `
    UPDATE dbo.D009015
    SET CustStatus = 2,
        DropOutDate = @operationDate,
        DropOutDoneBy = 11,
        DbtrUpdtChkId = DbtrUpdtChkId + 1
    WHERE CustNo = @custNo;
  `,

  SYNC_BRANCH_TRACKER: `
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
  `,

  GET_ACTIVE_BRANCHES: `SELECT BrCode FROM dbo.BranchDropoutTracker WHERE IsActive = 1`,

  UPDATE_BRANCH_STATS: `
    UPDATE dbo.BranchDropoutTracker 
    SET LastExecutionTime = GETDATE(),
        NoOfExecution = NoOfExecution + 1,
        NoOfDropout = NoOfDropout + @dropoutCount
    WHERE BrCode = @brCode;
  `,

  LOG_SUCCESS: `
    INSERT INTO Process_Log_Success (brCode, custNo, closedAccountsInfo, timestamp)
    VALUES (@brCode, @custNo, @info, @timestamp)
  `,

  LOG_ERROR: `
    INSERT INTO Process_Log_Error (brCode, custNo, failedStep, errorReason, timestamp)
    VALUES (@brCode, @custNo, @step, @reason, @timestamp)
  `,

  LOG_ANOMALY: `
    INSERT INTO Anomaly_Logs (CustNo, AccountType, AccountNo, LingeringBalance, LoggedAt)
    VALUES (@custNo, @accType, @accNo, @balance, @timestamp)
  `
};
