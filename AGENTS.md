# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Overview

Flight Schedule Bro is an automated flight training scheduler for Flight Schedule Pro that runs in two modes:

1. **CLI** - Interactive booking tool for local development
2. **Worker** - Cloudflare Worker that monitors availability and sends Discord notifications every 30 minutes

## Common Commands

### CLI Development

```bash
# Run the CLI interactively
npm start
# or
npm run exec

# Run tests
npm test                 # Run all tests once
npm run test:watch       # Run tests in watch mode
npm run test:ui          # Run tests with UI
npm run test:coverage    # Generate coverage report
```

### Cloudflare Worker

```bash
# Local development
npm run worker:dev

# Deploy to production
npm run worker:deploy

# View logs
npm run worker:tail
```

### Testing

- Test files are named `*.test.ts` and located alongside source files
- Integration tests: `*.integration.test.ts`
- Uses Vitest framework with globals enabled

### Quality checks

```bash
npm run check          # format + lint + typecheck + test (same as CI)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run format:check   # Prettier (no writes)
```

Husky runs on every commit: `lint-staged` (ESLint + Prettier on staged files), then `typecheck` and `test`.

## Architecture

### Dual-Runtime Design

The codebase supports both Node.js (CLI) and Cloudflare Workers runtime through:

1. **Dependency Injection for Caching**
   - `src/shared/dao/api_wrapper.ts` defines a `CacheAdapter` interface
   - CLI: Injects file-based cache via `src/cli/cache.ts` (uses filesystem)
   - Worker: No cache injection (stateless, uses KV store separately)
   - Call `setCacheAdapter()` at entry point to configure caching

2. **Environment Configuration**
   - `createConfig()` in `src/shared/util/config.ts` works with any env object
   - CLI: Uses dotenv to load `.env` file into `process.env`
   - Worker: Receives env from Cloudflare Workers `Env` interface

### Directory Structure

```
src/
├── cli/              # CLI-specific code (Node.js only)
│   ├── index.ts      # CLI entry point
│   └── cache.ts      # File-based cache implementation
├── worker/           # Cloudflare Worker-specific code
│   ├── index.ts      # Worker entry point (scheduled + fetch handlers)
│   ├── kv.ts         # KV namespace operations
│   ├── discord.ts    # Discord webhook notifications
│   ├── setup.ts      # Initial snapshot setup
│   └── metadata.ts   # FSP metadata caching
├── shared/           # Code shared between CLI and Worker
│   ├── blo/          # Business Logic Objects
│   │   ├── scheduler.ts           # Core scheduling logic
│   │   ├── scheduleGaps.ts        # Interval/gap computation from schedule grid
│   │   ├── scheduleAvailability.ts # Schedule snapshot → BookableAvailability
│   │   ├── workerAvailabilitySearch.ts # Worker cron search orchestration
│   │   └── calendar.ts            # Calendar integration (CLI only)
│   ├── dao/          # Data Access Objects (Flight Schedule Pro API)
│   │   ├── api_wrapper.ts  # Fetch wrapper with rate limiting & caching
│   │   ├── auth.ts         # Authentication
│   │   ├── availability.ts # BookableAvailability types and grouping helpers
│   │   ├── schedule.ts     # Schedule v2 grid API client
│   │   ├── aircraft.ts     # Aircraft data
│   │   ├── instructors.ts  # Instructor data
│   │   ├── reservationTypes.ts # Reservation types
│   │   ├── reservations.ts # Booking reservations
│   │   └── existingReservations.ts # Fetch existing reservations
│   └── util/         # Utilities
│       ├── config.ts       # Environment variable validation
│       ├── dates.ts        # Date/time utilities & validation
│       ├── subrequestBudget.ts # Cloudflare subrequest tracking (worker)
│       ├── snapshotTracking.ts # Rolling-window trackedThroughDate helpers
│       ├── interactive.ts  # CLI prompts (CLI only)
│       └── progressBar.ts  # Progress display (CLI only)
```

### Key Design Patterns

**SchedulerBLO** (`src/shared/blo/scheduler.ts`)

- Central orchestrator for availability searches and bookings
- Maintains maps of instructors, aircraft, and activity types
- Call `initialize()` before use to populate metadata
- `getBookableAvailability()` fetches the FSP Schedule v2 grid and computes gaps
- `bookReservation()` handles reservation creation

**Schedule Snapshot Search** (`src/shared/dao/schedule.ts`, `src/shared/blo/scheduleGaps.ts`)

- Uses `POST /api/v2/schedule` per day (CLI, worker, and activity-type upgrades)
- Paginates resources (50 per page) and merges events, unavailability, and closings
- Gap computation intersects aircraft and instructor free windows at 30-minute steps
- CLI: parallel day fetches capped by `DAYS_AHEAD` in `.env`
- Worker: sequential day fetches in `fetchScheduleDaysWithinBudget()` until the subrequest budget is exhausted (or `MAX_DAYS_AHEAD` is reached)
- CLI supports duration selection: 60, 90, or 120 minutes (defaults to reservation type `defaultLength`)
- 5-minute cache TTL per schedule page (CLI file cache only; worker is stateless)

**Worker Subrequest Budget** (`src/shared/util/subrequestBudget.ts`, `src/shared/blo/workerAvailabilitySearch.ts`)

- Tracks outgoing `fetch()` calls during each cron run (auth, FSP API, Discord)
- **Workers Free (default):** 50 external subrequests per invocation; KV uses a separate 1,000-op internal quota and is not counted
- **Workers Paid (`WORKERS_PAID_PLAN=true`):** unified 10,000 subrequest limit; KV get/put also counts
- Reserves 1 subrequest for Discord before schedule fetching
- Optional `MAX_DAYS_AHEAD` in `wrangler.toml` caps calendar days searched even when budget remains

**API Wrapper with Rate Limiting** (`src/shared/dao/api_wrapper.ts`)

- All FSP API calls go through `safeFetch()`
- Multi-layered rate limit handling:
  - Request queue: Max 20 concurrent requests
  - Staggered delays: 50ms between initial requests
  - Exponential backoff: 1s → 2s → 4s on retries
  - Caching: 30-minute TTL (configurable)
- Automatically retries on 429 (rate limit) and 5xx errors
- Uses Zod for runtime type validation

**Worker Rolling Window Algorithm** (`src/worker/scheduled.ts`, `src/shared/util/slots.ts`)

- `findNewSlots()` prevents false notifications when the searched date range advances
- Compares current snapshot to previous snapshot using `metadata.trackedThroughDate`
- Only notifies about slots within the previously tracked window
- Cleans up past slots automatically before each run

**Environment Validation** (`src/shared/util/config.ts`)

- Uses Zod schemas for runtime validation
- CLI loads from `.env` via dotenv (`DAYS_AHEAD`, etc.)
- Worker receives from Cloudflare `Env` / `wrangler.toml` (no `DAYS_AHEAD`; lookahead is budget-driven)
- Throws descriptive errors for missing/invalid config

## Testing Notes

- Mock `fetchAuth()` in tests that need authentication
- Use `getCachedResult` and `setCachedResult` for cache testing
- Integration tests require real FSP credentials (use `.env` or env vars)
- Worker tests mock the `Env` interface and KV namespace

## Important API Constraints

1. **Schedule Pagination**: Resource pages are capped at 50 per day-query
2. **Rate Limiting**: FSP API has rate limits — use caching and exponential backoff
3. **Cloudflare Worker Limits** (see [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests)):
   - **Free:** 50 external subrequests per cron invocation; KV/D1/R2 use a separate 1,000-op internal quota
   - **Paid:** unified subrequest pool (default 10,000); set `WORKERS_PAID_PLAN=true` so KV is tracked
   - Worker fills the external/unified budget sequentially — no manual day-count tuning required on Free
4. **Time Zones**: All times are local timezone; schedule grid uses `YYYY-MM-DD HH:mm:ss`

**KV Snapshot Structure**:

```typescript
{
  metadata: {
    lastSearchDate: "2024-11-15",       // Rolling window anchor (today at search time)
    lastUpdate: "2024-11-15T10:30:00Z",
    trackedThroughDate: "2024-12-27"    // Last calendar day fully fetched
    // legacy snapshots may still have daysAhead instead of trackedThroughDate
  },
  slots: [ /* BookableAvailabilityKV[] */ ]
}
```

**Metadata Caching**:

- FSP metadata (instructors, aircraft, types) cached in KV as `fsp-metadata`
- Refreshed via `/refresh-metadata` endpoint
- Saves 3 API calls per scheduled run

**Setup Flow**:

1. Call `/setup` to initialize snapshot
2. Call `/refresh-metadata` to cache FSP metadata
3. Cron runs every 30 minutes automatically

## Configuration Files

- `.env` - CLI environment variables (not in git); includes `DAYS_AHEAD`
- `wrangler.toml` - Worker `[vars]` (`AIRCRAFT_REGEX`, `MAX_DAYS_AHEAD`, `WORKERS_PAID_PLAN`, etc.) and KV bindings
- `.dev.vars` - Worker secrets for local `wrangler dev` (see `.dev.vars.example`)
- `vitest.config.ts` - Test configuration
- `tsconfig.json` - TypeScript configuration (extends @tsconfig/node24)
