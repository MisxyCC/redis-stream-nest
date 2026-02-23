# Redis Stream NestJS Workflow

A NestJS application demonstrating a workflow system powered by Redis Streams and Fastify.

## Project Overview

- **Framework**: [NestJS](https://nestjs.com/) with [Fastify](https://www.fastify.io/) adapter.
- **Language**: TypeScript.
- **Messaging**: [Redis Streams](https://redis.io/docs/data-types/streams/) using the `ioredis` library.
- **Architecture**:
    - **Producer**: API endpoints (`/workflow/submit`, `/workflow/approve`) that push events to a Redis Stream.
    - **Consumer**: A background worker (part of `WorkflowService`) that listens to the stream using consumer groups, processes events (e.g., notifying managers, generating PDFs), and acknowledges them.
    - **Reliability**: Implements message recovery using `xautoclaim` to handle "stuck" messages that were never acknowledged.

## Getting Started

### Prerequisites

- Node.js (v18+)
- Redis Stack (via Docker Compose)

### Infrastructure Setup

```bash
# Start Redis Stack and Redis Insight (GUI)
docker-compose up -d
```
- **Redis**: `localhost:6379` (Static IP: `192.168.1.10`)
- **Redis Insight**: `http://localhost:8001`

### Installation

```bash
npm install
```

### Running the Application

```bash
# Development mode (watch)
npm run start:dev

# Production mode
npm run start:prod
```

The server will be available at `http://localhost:3000`.

### Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e
```

## API Endpoints

### 1. Submit Document
`POST /workflow/submit`
- Body: `{ "docId": "doc123", "userId": "user456" }`
- Event: `DOCUMENT_SUBMITTED`

### 2. Approve Document
`POST /workflow/approve`
- Body: `{ "docId": "doc123", "approverId": "admin789" }`
- Event: `DOCUMENT_APPROVED`

## Development Conventions

- **Fastify Integration**: The app uses `FastifyAdapter` in `main.ts`. Note that the host is set to `0.0.0.0` for container/external access.
- **Redis Service**: `WorkflowService` manages the Redis lifecycle (`onModuleInit`, `onModuleDestroy`).
- **Consumer Group**: Uses a group named `approval_workers_group`. Each instance/process acts as a unique consumer (`worker_${process.pid}`).
- **Error Handling**: Implements a retry delay and a separate recovery loop for robustness.
