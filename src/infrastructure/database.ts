import sql from 'mssql';
import dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

const primaryConfig: sql.config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: true,
    trustServerCertificate: true
  }
};

const historyConfig: sql.config = {
  user: process.env.DB_USER_2,
  password: process.env.DB_PASSWORD_2,
  server: process.env.DB_SERVER_2 || 'localhost',
  database: process.env.DB_NAME_2,
  port: parseInt(process.env.DB_PORT_2 || '1433', 10),
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: true,
    trustServerCertificate: true
  }
};

export class Database {
  private static pool: sql.ConnectionPool | null = null;
  private static historyPool: sql.ConnectionPool | null = null;

  /**
   * Returns the primary database connection pool.
   */
  public static async getConnection(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    try {
      this.pool = await new sql.ConnectionPool(primaryConfig).connect();
      logger.info('Connected to Primary MSSQL database successfully.', { context: 'Database' });
      
      this.pool.on('error', (err) => {
        logger.error('Primary database connection pool error', { context: 'Database', error: err });
        this.pool = null;
      });

      return this.pool;
    } catch (error) {
      logger.error('Primary database connection failed', { context: 'Database', error });
      this.pool = null;
      throw error;
    }
  }

  /**
   * Returns the secondary (History) database connection pool.
   */
  public static async getHistoryConnection(): Promise<sql.ConnectionPool> {
    if (this.historyPool && this.historyPool.connected) {
      return this.historyPool;
    }

    try {
      this.historyPool = await new sql.ConnectionPool(historyConfig).connect();
      logger.info('Connected to History MSSQL database successfully.', { context: 'Database' });
      
      this.historyPool.on('error', (err) => {
        logger.error('History database connection pool error', { context: 'Database', error: err });
        this.historyPool = null;
      });

      return this.historyPool;
    } catch (error) {
      logger.error('History database connection failed', { context: 'Database', error });
      this.historyPool = null;
      throw error;
    }
  }

  /**
   * Closes all active connection pools.
   */
  public static async closeAll(): Promise<void> {
    const closures = [];
    if (this.pool) closures.push(this.pool.close());
    if (this.historyPool) closures.push(this.historyPool.close());
    await Promise.all(closures);
    this.pool = null;
    this.historyPool = null;
    logger.info('All database connections closed.', { context: 'Database' });
  }
}
