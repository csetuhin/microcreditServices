import winston from 'winston';
import 'winston-daily-rotate-file';
import dotenv from 'dotenv';

dotenv.config();

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Define a type for the log information to fix implicit 'any' errors
interface LogInfo {
  level: string;
  message: string;
  timestamp?: string;
  context?: string;
  stack?: string;
}

// Custom format: [Timestamp] [Level] [Context]: Message
const customFormat = printf((info: winston.Logform.TransformableInfo) => {
  const { level, message, timestamp, context, stack } = info as LogInfo;
  const contextStr = context ? ` [${context}]` : '';
  const content = stack || message;
  return `[${timestamp}] [${level}]${contextStr}: ${content}`;
});

const logLevel = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';

const transports: winston.transport[] = [];

// Configuration for Non-Production (UAT, Development)
if (!isProduction) {
  transports.push(
    new winston.transports.Console({
      level: logLevel,
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        customFormat
      ),
    })
  );
} else {
  // Configuration for Production
  transports.push(
    new winston.transports.DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info',
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        customFormat
      ),
    }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        customFormat
      ),
    })
  );
}

export const logger = winston.createLogger({
  level: logLevel,
  transports,
  exitOnError: false,
});
