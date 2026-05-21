export interface EligibleCustomer {
  custNo: string;
  brCode: string;
  totalBalance: number;
}

export interface AccountState {
  type: 'SAVINGS' | 'LOAN' | 'TERM_DEPOSIT';
  accountNo: string;
  status: number;
  balance: number;
  penalPaidFcy: number;
  penalPrvdFcy: number;
  totalCredit: number;
}

export interface CustomerAccountsState {
  loans: AccountState[];
  termDeposits: AccountState[];
  savings: AccountState[];
}

export interface AnomalyLog {
  custNo: string;
  accountType: string;
  accountNo: string;
  lingeringBalance: number;
  timestamp: Date;
}

export interface BatchDropoutCommand {
  custNo: string;
  brCode: string;
  operationDate: Date;
  accountsToClose: {
    type: 'SAVINGS' | 'TERM_DEPOSIT' | 'LOAN';
    accountNo: string;
    zeroOutBalance: boolean;
  }[];
  anomaliesToLog: AnomalyLog[];
}

export interface ProcessLogSuccess {
  brCode: string;
  custNo: string;
  closedAccountsInfo: string;
  timestamp: Date;
}

export interface ProcessLogError {
  brCode: string;
  custNo: string;
  failedStep: string;
  errorReason: string;
  timestamp: Date;
}
