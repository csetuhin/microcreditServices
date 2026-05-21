# Core Banking / Microfinance Dropout System

A highly critical background job and API for managing customer dropouts in a Core Banking system, built with NodeJS, TypeScript, and Express using **Hexagonal Architecture (Domain-Driven Design)**.

## Project Structure

The project follows a strict Hexagonal (Ports & Adapters) architecture to ensure the core business logic is decoupled from infrastructure details like the MSSQL database and the Express web framework.

```text
micro-credit-system/
├── src/
│   ├── domain/                 # Core Entities & Models (The "Inside")
│   │   └── models.ts           # Shared interfaces (EligibleCustomer, AccountCheckResult, etc.)
│   │
│   ├── application/            # Business Logic & Use Cases
│   │   ├── ports/              # Driving & Driven Ports (Interfaces)
│   │   │   └── ICustomerRepository.ts
│   │   └── services/           # Orchestration Services
│   │       └── DropoutProcessService.ts (Handles transactions and business rules)
│   │
│   ├── infrastructure/         # External Tools & Adapters (The "Outside")
│   │   ├── adapters/           # Concrete implementations of Application Ports
│   │   │   └── CustomerRepository.ts (MSSQL Data Access)
│   │   └── database.ts         # MSSQL Connection Pooling logic
│   │
│   ├── presentation/           # Entry Points (API, Cron, CLI)
│   │   ├── controllers/        # Express Controllers (API Trigger)
│   │   ├── cron/               # Background Job Schedulers (Nightly 2 AM Job)
│   │   └── routes.ts           # Express API Routing definitions
│   │
│   └── index.ts                # Application Bootstrap / Entry Point
│
├── dist/                       # Compiled JavaScript (Target)
├── .env                        # Environment Configuration (DB credentials)
├── package.json                # Dependencies & Scripts
└── tsconfig.json               # TypeScript Configuration (Strict Mode)
```

## Features Implemented

### 1. Robust Transaction Management
- **Per-Customer Isolation**: Each customer is processed in a separate MSSQL transaction.
- **Atomic Operations**: Account closing and dropout marking are grouped in a single transaction.
- **Safe Rollbacks**: Implemented `transactionStarted` tracking to handle database errors without crashing the service.

### 2. Dual-Trigger Mechanism
- **REST API**: Trigger the process on-demand via `POST /api/v1/dropout/:brCode`. Returns a `202 Accepted` to avoid timeouts.
- **Nightly Cron**: Automatically runs at 2:00 AM every night for pre-configured branches using `node-cron`.

### 3. Detailed Logging
- **Success Log**: Records branch, customer ID, and exactly which accounts were closed.
- **Error Log**: Records the exact step where failure occurred (`CHECK_ACCOUNTS`, `CLOSE_SAVINGS`, etc.) and the error reason.

### 4. Enterprise-Grade Setup
- **Strict TypeScript**: Configured with `strict: true` and `ES2022` target.
- **Connection Pooling**: Managed via a singleton `Database` class for high performance.
- **ESM Support**: Configured for modern ECMAScript Modules (`type: module`).

## Getting Started

### Prerequisites
- Node.js (v18+)
- MSSQL Server

### Setup
1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure Environment:
   Update `.env` with your MSSQL credentials.

3. Build and Run:
   ```bash
   npm run build
   npm start
   ```

## API Reference

### Trigger Dropout Process
- **Endpoint**: `POST /api/v1/dropout/:brCode`
- **Response**: `202 Accepted`
- **Description**: Starts the background process for all eligible customers in the specified branch.
