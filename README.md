# OutBox — Production-Grade Email Job Scheduler

A full-stack email scheduling system inspired by the core scheduling infrastructure of ReachInbox.

The application allows authenticated users to create email campaigns, schedule emails for future delivery, process them through BullMQ and Redis, send them through Ethereal SMTP, enforce distributed rate limits, maintain email state in PostgreSQL, and index emails in Elasticsearch for search.

---

## 1. Project Overview

### Problem

Reliable email scheduling requires more than simply sending an email.

A production-style system must handle:

* Future email scheduling
* Persistent jobs
* Server restarts
* Duplicate prevention
* Multiple concurrent workers
* Provider throttling
* Hourly sending limits
* Failed email tracking
* Campaign-level statistics
* Searchable email records
* Frontend monitoring and management

### Solution

OutBox uses:

```text
                    ┌─────────────────────┐
                    │   Next.js Frontend  │
                    └──────────┬──────────┘
                               │
                               │ HTTP API
                               ▼
                    ┌─────────────────────┐
                    │   Express Backend   │
                    └───────┬─────┬───────┘
                            │     │
                 ┌──────────┘     └─────────────┐
                 ▼                              ▼
        ┌─────────────────┐             ┌───────────────┐
        │   PostgreSQL    │             │  Elasticsearch│
        │  Source of Truth│             │ Email Search  │
        └─────────────────┘             └───────────────┘
                 │
                 │ Email records
                 ▼
        ┌─────────────────┐
        │ BullMQ + Redis  │
        │ Delayed Jobs    │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Email Worker(s) │
        │ Concurrency     │
        │ Rate Limiting   │
        │ Idempotency     │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Ethereal SMTP   │
        │ Fake Email      │
        └─────────────────┘
```

---

# 2. Technology Stack

## Backend

* Node.js
* TypeScript
* Express.js
* Prisma ORM
* PostgreSQL
* BullMQ
* Redis
* Nodemailer
* Ethereal Email
* Zod
* Passport

## Frontend

* Next.js
* React
* TypeScript
* Tailwind CSS

## Search

* Elasticsearch 8.x
* `@elastic/elasticsearch` 8.x client

## Infrastructure

* Docker
* Docker Compose

---

# 3. Repository Structure

```text
OUTBOX/
│
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   │
│   ├── src/
│   │   ├── lib/
│   │   │   ├── elasticsearch.ts
│   │   │   ├── mailer.ts
│   │   │   ├── passport.ts
│   │   │   ├── prisma.ts
│   │   │   ├── queue.ts
│   │   │   ├── rateLimiter.ts
│   │   │   └── redis.ts
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   └── campaigns.ts
│   │   │
│   │   ├── server.ts
│   │   ├── worker.ts
│   │   └── seed.ts
│   │
│   ├── .env
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   └── dashboard/
│   │   └── components/
│   │
│   ├── .env
│   └── package.json
│
├── docker-compose.yml
└── README.md
```

---

# 4. Prerequisites

Install the following:

* Node.js 20+
* npm
* Docker
* Docker Compose
* Git

Verify:

```bash
node --version
npm --version
docker --version
docker compose version
git --version
```

---

# 5. Infrastructure Setup

The project uses Docker for local infrastructure.

Start PostgreSQL, Redis and Elasticsearch:

```bash
docker compose up -d
```

Check containers:

```bash
docker compose ps
```

Expected services include:

```text
PostgreSQL
Redis
Elasticsearch
```

Verify Redis:

```bash
docker compose ps
```

Verify Elasticsearch:

```bash
curl http://localhost:9200
```

Expected Elasticsearch response contains:

```json
{
  "cluster_name": "docker-cluster",
  "version": {
    "number": "8.x.x"
  }
}
```

Verify Elasticsearch email index:

```bash
curl http://localhost:9200/_cat/indices?v
```

The application creates the following index automatically:

```text
emails
```

---

# 6. Backend Setup

Move into backend:

```bash
cd backend
```

Install dependencies:

```bash
npm install
```

Create:

```text
backend/.env
```

Example:

```env
DATABASE_URL="postgresql://outbox:outbox_password@localhost:5434/outbox"

REDIS_HOST=localhost
REDIS_PORT=6381

ELASTICSEARCH_URL=http://localhost:9200

SESSION_SECRET=replace_this_with_a_long_random_secret

GOOGLE_CLIENT_ID=placeholder_for_now
GOOGLE_CLIENT_SECRET=placeholder_for_now
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

WORKER_CONCURRENCY=5
MIN_EMAIL_DELAY_MS=2000
```

Do not commit real secrets.

---

# 7. Database Setup

Generate Prisma client:

```bash
npx prisma generate
```

Apply migrations:

```bash
npx prisma migrate dev
```

If the project uses an existing migration state, use the migration commands appropriate for the current Prisma schema.

Check database:

```bash
npx prisma studio
```

---

# 8. Start Backend API

From:

```bash
cd backend
```

Run:

```bash
npm run dev
```

The Express server should start on the configured backend port.

---

# 9. Start BullMQ Worker

Open a second terminal:

```bash
cd backend
npm run worker
```

Expected output:

```text
Elasticsearch index "emails" created
[worker] Started with concurrency=5, minDelay=2000ms
```

If the Elasticsearch index already exists, only the worker startup message is expected.

---

# 10. Start Frontend

Open a third terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Next.js application in the browser.

---

# 11. Email Scheduling Flow

The campaign creation API accepts:

```json
{
  "senderId": "sender-id",
  "subject": "Test email",
  "body": "<h1>Hello</h1>",
  "recipients": [
    "recipient@example.com"
  ],
  "startTime": "2026-08-28T18:00:00.000Z",
  "delayMs": 2000,
  "hourlyLimit": 10
}
```

The backend performs the following:

```text
1. Validate request
       ↓
2. Create Campaign in PostgreSQL
       ↓
3. Create Email records
       ↓
4. Calculate scheduledAt for each email
       ↓
5. Add each email to BullMQ
       ↓
6. BullMQ stores delayed job in Redis
       ↓
7. Worker receives job at scheduled time
       ↓
8. Worker checks idempotency
       ↓
9. Worker checks hourly rate limit
       ↓
10. Worker enforces minimum delay
       ↓
11. Worker sends through Ethereal SMTP
       ↓
12. PostgreSQL status becomes SENT/FAILED
       ↓
13. Elasticsearch document is updated
```

---

# 12. Why BullMQ Instead of Cron?

The system deliberately does not use:

* `cron`
* `node-cron`
* `agenda`
* OS-level scheduled tasks

Future emails are represented as BullMQ delayed jobs.

Example:

```text
Email scheduled for 10:00 AM
        ↓
BullMQ delayed job
        ↓
Redis persists job
        ↓
Worker receives job at 10:00 AM
        ↓
Email sent
```

This makes scheduling persistent and independent of an application process's in-memory timers.

---

# 13. Persistence and Server Restart

PostgreSQL stores the source-of-truth email records.

Redis stores BullMQ jobs.

Therefore:

```text
Application stopped
       ↓
PostgreSQL remains
       ↓
Redis remains
       ↓
BullMQ jobs remain
       ↓
Application restarted
       ↓
Worker reconnects
       ↓
Future jobs continue processing
```

The system does not rebuild the campaign from the beginning after a restart.

---

# 14. Idempotency

Each email has a unique database ID and idempotency key.

BullMQ jobs use the email ID as the job ID:

```text
jobId = email.id
```

The worker also checks the database before sending.

If:

```text
email.status === SENT
```

the worker skips the job.

This protects against duplicate sends during retries or worker restarts.

---

# 15. Worker Concurrency

Worker concurrency is configurable through:

```env
WORKER_CONCURRENCY=5
```

The worker is created with:

```text
concurrency = 5
```

This allows multiple email jobs to be processed concurrently.

Concurrency is not hardcoded and can be changed through environment configuration.

---

# 16. Minimum Delay Between Emails

The project uses:

```env
MIN_EMAIL_DELAY_MS=2000
```

Therefore the configured minimum delay is:

```text
2 seconds
```

The delay is enforced using Redis-backed coordination so multiple workers do not independently ignore the sender's throttling requirement.

---

# 17. Hourly Rate Limiting

Each campaign has an hourly limit.

Example:

```text
hourlyLimit = 10
```

The rate limiter uses Redis-backed counters rather than only in-memory counters.

This allows rate limiting to remain consistent across multiple worker processes.

When the hourly limit is reached:

```text
Worker
  ↓
Redis says limit reached
  ↓
Job is not permanently failed
  ↓
Job is delayed
  ↓
Next available hour
  ↓
Worker processes job again
```

Jobs are therefore retained instead of being dropped.

---

# 18. Multiple Senders

Emails contain a `senderId`.

Rate limiting is tracked against the sender, allowing different senders to have independent limits.

Conceptually:

```text
Sender A → hourly limit
Sender B → hourly limit
Sender C → hourly limit
```

This prevents one sender's rate limit from unnecessarily blocking unrelated senders.

---

# 19. Ethereal Email

The application uses Ethereal SMTP for safe development/testing.

Ethereal does not deliver real production emails. It provides a fake SMTP environment and browser preview links.

The worker creates an SMTP transport using the sender's configured Ethereal credentials.

After successful sending, the worker logs an Ethereal preview URL.

Example:

```text
[worker] Email <id> sent successfully.
[worker] Ethereal Preview URL: <preview-url>
```

---

# 20. Elasticsearch

Elasticsearch is used to make email records searchable.

Index:

```text
emails
```

Important indexed fields include:

```text
id
campaignId
senderId
recipient
subject
body
status
scheduledAt
sentAt
messageId
errorMessage
createdAt
```

Verify the index:

```bash
curl http://localhost:9200/_cat/indices?v
```

Check document count:

```bash
curl http://localhost:9200/emails/_count
```

Search documents:

```bash
curl "http://localhost:9200/emails/_search?pretty"
```

PostgreSQL remains the source of truth while Elasticsearch provides search capability.

---

# 21. Campaign Features

The backend supports campaign management including:

* Campaign creation
* Email scheduling
* Sender selection
* Configurable delay
* Configurable hourly limit
* Campaign statistics
* Email logs
* Email status tracking
* Scheduled emails
* Processing emails
* Sent emails
* Failed emails
* Pause/resume/cancel campaign functionality where exposed by the application

---

# 22. Email Status Lifecycle

An email can move through states such as:

```text
SCHEDULED
    ↓
PROCESSING
    ↓
SENT
```

or:

```text
SCHEDULED
    ↓
PROCESSING
    ↓
FAILED
```

The database stores the final state and error information.

---

# 23. Frontend

The frontend provides the dashboard experience for managing campaigns and emails.

Main areas include:

### Dashboard

* User information
* Campaign overview
* Scheduled emails
* Sent emails
* Campaign statistics

### Compose Email

Users can provide:

* Subject
* Body
* Recipients
* Start time
* Delay between emails
* Hourly limit
* Sender

### Email Tables

Scheduled and sent emails display information including:

```text
Email
Subject
Scheduled/Sent Time
Status
```

Loading and empty states are handled in the UI.

---

# 24. API Endpoints

## Authentication

```text
GET /auth/*
```

Authentication routes are implemented in:

```text
backend/src/routes/auth.ts
```

## Campaigns

Create campaign:

```http
POST /campaigns
```

Get campaigns:

```http
GET /campaigns
```

Campaign statistics:

```http
GET /campaigns/:id/stats
```

Campaign email logs:

```http
GET /campaigns/:id/emails
```

Optional status filtering:

```http
GET /campaigns/:id/emails?status=SENT
```

---

# 25. Testing and Verification

### TypeScript Backend

```bash
cd backend
npx tsc --noEmit
```

Expected:

```text
No TypeScript errors
```

### Frontend Production Build

```bash
cd frontend
npm run build
```

Expected:

```text
Compiled successfully
Finished TypeScript
Generating static pages
```

### Elasticsearch

```bash
curl http://localhost:9200
```

### Elasticsearch Index

```bash
curl http://localhost:9200/_cat/indices?v
```

### Elasticsearch Documents

```bash
curl http://localhost:9200/emails/_count
```

---

# 26. Restart Persistence Test

This is an important demonstration scenario.

### Step 1

Schedule an email several minutes into the future.

### Step 2

Stop the backend and worker.

### Step 3

Do NOT delete Redis or PostgreSQL containers.

### Step 4

Start backend:

```bash
npm run dev
```

### Step 5

Start worker:

```bash
npm run worker
```

### Step 6

Wait for the scheduled time.

The BullMQ job should still be available and the email should be processed.

This demonstrates that scheduling is persistent and does not depend on an in-memory timer.

---

# 27. Rate Limit Demonstration

Configure a small limit for testing:

```text
hourlyLimit = 2
```

Schedule several emails.

Expected behavior:

```text
Email 1 → SENT
Email 2 → SENT
Email 3 → delayed
Email 4 → delayed
...
```

The jobs should not be permanently discarded.

For the actual assignment demonstration, configure a practical value through the campaign UI/API.

---

# 28. Environment Variables

Backend:

| Variable               | Purpose                           |
| ---------------------- | --------------------------------- |
| `DATABASE_URL`         | PostgreSQL connection             |
| `REDIS_HOST`           | Redis hostname                    |
| `REDIS_PORT`           | Redis port                        |
| `ELASTICSEARCH_URL`    | Elasticsearch URL                 |
| `SESSION_SECRET`       | Session encryption/signing secret |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID            |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret        |
| `GOOGLE_CALLBACK_URL`  | Google OAuth callback             |
| `WORKER_CONCURRENCY`   | BullMQ worker concurrency         |
| `MIN_EMAIL_DELAY_MS`   | Minimum delay between sends       |

Secrets must be provided through environment variables and must not be committed to Git.

---

# 29. Docker Services

Recommended local infrastructure:

```text
PostgreSQL
Redis
Elasticsearch
```

Start:

```bash
docker compose up -d
```

Stop:

```bash
docker compose down
```

View logs:

```bash
docker compose logs -f
```

---

# 30. Production Considerations

For a production deployment, the following should be considered:

* Managed PostgreSQL
* Managed Redis
* Managed Elasticsearch
* HTTPS
* Secure cookie configuration
* Secret management
* OAuth production credentials
* Reverse proxy/load balancer
* Worker autoscaling
* Structured logging
* Metrics
* Error monitoring
* Database backups
* Redis persistence
* Elasticsearch snapshots
* Email provider with real production SMTP/API
* Per-tenant rate limits
* Dead-letter/retry strategy
* Health checks
* Graceful shutdown

The current project uses Ethereal because the assignment explicitly requires a fake SMTP provider.

---

# 31. Assignment Requirement Mapping

## Backend

| Requirement                | Status                   |
| -------------------------- | ------------------------ |
| TypeScript                 | Implemented              |
| Express.js                 | Implemented              |
| PostgreSQL                 | Implemented              |
| Prisma                     | Implemented              |
| Redis                      | Implemented              |
| BullMQ                     | Implemented              |
| Delayed jobs               | Implemented              |
| No cron                    | Implemented              |
| Worker concurrency         | Implemented              |
| Minimum email delay        | Implemented              |
| Hourly rate limiting       | Implemented              |
| Redis-backed rate limiting | Implemented              |
| Rate-limit rescheduling    | Implemented              |
| Idempotency                | Implemented              |
| Multiple senders           | Implemented              |
| Ethereal SMTP              | Implemented              |
| Campaign management        | Implemented              |
| Email logs                 | Implemented              |
| Campaign statistics        | Implemented              |
| Elasticsearch indexing     | Implemented              |
| Elasticsearch search API   | To be finalized          |
| Live BullMQ dashboard      | To be finalized          |
| Slack OAuth + notification | To be finalized          |
| Google production OAuth    | To be finalized/verified |

## Frontend

| Requirement               | Status                                    |
| ------------------------- | ----------------------------------------- |
| React/Next.js             | Implemented                               |
| TypeScript                | Implemented                               |
| Tailwind/CSS              | Implemented                               |
| Dashboard                 | Implemented                               |
| Compose email             | Implemented                               |
| Scheduled emails          | Implemented                               |
| Sent emails               | Implemented                               |
| Loading states            | Implemented                               |
| Empty states              | Implemented                               |
| Error handling            | Implemented                               |
| CSV/text recipient upload | Implemented/verify before submission      |
| Google OAuth UI           | Implemented/verify production credentials |

---

# 32. Current Known Limitations

The following items must be completed or verified before claiming the assignment is fully complete:

1. Elasticsearch search endpoint and frontend search UI should be verified.
2. BullMQ live monitoring dashboard should be exposed and verified.
3. Google OAuth must use real Google Cloud OAuth credentials rather than placeholders.
4. Slack OAuth and live rate-limit notifications must be configured and tested.
5. CSV/text upload should be tested with real files.
6. Full restart/persistence testing should be performed.
7. End-to-end testing should be performed before final submission.

These are intentionally documented rather than represented as complete features if they have not been live-tested.

---

# 33. Security Notes

Never commit:

```text
.env
OAuth client secrets
SMTP passwords
SESSION_SECRET
Database passwords
Redis passwords
API tokens
Slack tokens
```

Use:

```text
.env.example
```

for non-secret configuration documentation.

For production:

* Enable HTTPS
* Use secure cookies
* Rotate secrets
* Restrict CORS
* Validate all API input
* Apply authentication/authorization
* Use least-privilege database credentials

---

# 34. Git Workflow

Check status:

```bash
git status
```

Add changes:

```bash
git add .
```

Commit:

```bash
git commit -m "docs: add production project documentation"
```

Push:

```bash
git push origin main
```

---

# 35. Submission Checklist

Before submitting to ReachInbox, verify:

* [ ] GitHub repository is private
* [ ] Reviewer access has been granted
* [ ] `.env` is NOT committed
* [ ] `.env.example` exists
* [ ] README is present
* [ ] Backend TypeScript compiles
* [ ] Frontend production build succeeds
* [ ] Docker services start
* [ ] PostgreSQL works
* [ ] Redis works
* [ ] Elasticsearch works
* [ ] Elasticsearch `emails` index exists
* [ ] Campaign creation works
* [ ] BullMQ delayed jobs work
* [ ] Worker starts successfully
* [ ] Ethereal email sending works
* [ ] Email status changes to SENT/FAILED
* [ ] Duplicate sending is prevented
* [ ] Rate limiting works
* [ ] Rate-limited jobs are rescheduled
* [ ] Restart persistence works
* [ ] Google OAuth is configured
* [ ] Slack OAuth is configured
* [ ] Slack rate-limit notification works
* [ ] Search works
* [ ] BullMQ dashboard is accessible
* [ ] Demo video is recorded
* [ ] Final GitHub push is complete

---

# 36. Demo Video Plan — Maximum 5 Minutes

Recommended demonstration:

### 0:00–0:30 — Introduction

Briefly explain:

> "This project is a production-style email scheduling system built using Next.js, Express, PostgreSQL, Redis, BullMQ, Elasticsearch and Ethereal SMTP."

### 0:30–1:30 — Dashboard

Show:

* Login
* Dashboard
* User information
* Scheduled emails
* Sent emails
* Compose flow

### 1:30–2:30 — Scheduling

Create a campaign with multiple recipients.

Show:

```text
Campaign created
↓
Scheduled emails
↓
BullMQ worker
```

### 2:30–3:30 — Sending

Show worker logs:

```text
Processing job
Sending email
SENT
Ethereal preview URL
```

Show the email in Ethereal.

### 3:30–4:15 — Persistence

Schedule a future email.

Stop backend/worker.

Start them again.

Show that the scheduled job remains and is processed.

### 4:15–5:00 — Rate limiting / infrastructure

Show:

* Redis
* Elasticsearch
* Rate limit behavior
* Elasticsearch indexed document
* Optional BullMQ dashboard

---

# 37. Architecture Decisions

### PostgreSQL

Used as the authoritative database because email and campaign state is relational and transactional.

### Redis

Used by BullMQ for persistent queue state and by the distributed rate limiter.

### BullMQ

Used for reliable delayed job scheduling without cron.

### Elasticsearch

Used as the search/indexing layer while PostgreSQL remains the source of truth.

### Ethereal

Used because the assignment requires fake SMTP and provides safe email testing without sending real emails.

---

# 38. Design Principles

The implementation follows these principles:

* PostgreSQL as source of truth
* Redis for distributed coordination
* BullMQ for scheduling
* Workers are horizontally scalable
* Configuration through environment variables
* Idempotent email processing
* Explicit email state transitions
* Graceful handling of failed sends
* No cron-based scheduling
* Search separated from transactional storage

---

# 39. Final Note

This project is intended as an internship assignment demonstrating the core architecture required for a reliable email scheduling platform.

The system prioritizes:

```text
Reliability
Scalability
Persistence
Idempotency
Rate Limiting
Observability
Clean Architecture
```

over unnecessary complexity.

Built as part of the ReachInbox software development internship assignment.

