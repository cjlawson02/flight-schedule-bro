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
│   │   ├── scheduler.ts    # Core scheduling logic
│   │   └── calendar.ts     # Calendar integration (CLI only)
│   ├── dao/          # Data Access Objects (Flight Schedule Pro API)
│   │   ├── api_wrapper.ts  # Fetch wrapper with rate limiting & caching
│   │   ├── auth.ts         # Authentication
│   │   ├── availability.ts # Availability search
│   │   ├── aircraft.ts     # Aircraft data
│   │   ├── instructors.ts  # Instructor data
│   │   ├── reservationTypes.ts # Reservation types
│   │   ├── reservations.ts # Booking reservations
│   │   └── existingReservations.ts # Fetch existing reservations
│   └── util/         # Utilities
│       ├── config.ts       # Environment variable validation
│       ├── dates.ts        # Date/time utilities & validation
│       ├── array.ts        # Array helpers (chunking)
│       ├── interactive.ts  # CLI prompts (CLI only)
│       └── progressBar.ts  # Progress display (CLI only)
```

### Key Design Patterns

**SchedulerBLO** (`src/shared/blo/scheduler.ts`)
- Central orchestrator for availability searches and bookings
- Maintains maps of instructors, aircraft, and activity types
- Call `initialize()` before use to populate metadata
- `getBookableAvailability()` returns enriched results with display names
- `bookReservation()` handles reservation creation

**API Wrapper with Rate Limiting** (`src/shared/dao/api_wrapper.ts`)
- All FSP API calls go through `safeFetch()`
- Multi-layered rate limit handling:
  - Request queue: Max 50 concurrent requests
  - Staggered delays: 50ms between initial requests
  - Exponential backoff: 1s → 2s → 4s on retries
  - Caching: 30-minute TTL (configurable)
- Automatically retries on 429 (rate limit) and 5xx errors
- Uses Zod for runtime type validation

**Chunking Strategy** (`src/shared/util/array.ts`)
- FSP API limits to 3 instructors per availability request
- `chunk()` helper splits instructor arrays into groups of 3
- Used in both CLI and Worker to avoid API errors

**Worker Rolling Window Algorithm** (`src/worker/index.ts`)
- `findNewSlots()` prevents false notifications when date range advances
- Compares current snapshot to previous snapshot
- Only notifies about slots within the previously tracked window
- Cleans up past slots automatically before each run

**Environment Validation** (`src/shared/util/config.ts`)
- Uses Zod schemas for runtime validation
- CLI loads from `.env` via dotenv
- Worker receives from Cloudflare environment
- Throws descriptive errors for missing/invalid config

## Testing Notes

- Mock `fetchAuth()` in tests that need authentication
- Use `getCachedResult` and `setCachedResult` for cache testing
- Integration tests require real FSP credentials (use `.env` or env vars)
- Worker tests mock the `Env` interface and KV namespace

## Important API Constraints

1. **Instructor Limit**: Max 3 instructors per availability request (enforced by FSP API)
2. **Rate Limiting**: FSP API has rate limits - use chunking and exponential backoff
3. **Cloudflare Worker Limits**:
   - 50 subrequest limit (stay under with `DAYS_AHEAD` config)
   - KV operations count toward limits
4. **Time Zones**: All times are local timezone, formatted as `YYYY-MM-DDTHH:mm`

## Worker-Specific Concepts

**KV Snapshot Structure**:
```typescript
{
  metadata: {
    lastSearchDate: "2024-11-15",  // Rolling window anchor
    lastUpdate: "2024-11-15T10:30:00Z",
    daysAhead: 14
  },
  slots: {
    "slot-key-1": { ...BookableAvailability },
    "slot-key-2": { ...BookableAvailability }
  }
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

- `.env` - CLI environment variables (not in git)
- `wrangler.toml` - Worker configuration and KV bindings
- `vitest.config.ts` - Test configuration
- `tsconfig.json` - TypeScript configuration (extends @tsconfig/node24)
