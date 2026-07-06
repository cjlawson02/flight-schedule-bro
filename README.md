# Flight Schedule Bro

An automated flight training scheduler for Flight Schedule Pro that intelligently finds and books available time slots based on your preferences.

## Features

### CLI (Interactive Booking)

- 🔍 **Smart Availability Search** - Searches multiple days ahead for available time slots
- 🎯 **Preference-Based Filtering** - Configurable time preferences (weekdays, weekends, min/max hours)
- ✈️ **Aircraft Selection** - Filter by specific aircraft models (e.g., 172S, 172N)
- 👨‍✈️ **Instructor Matching** - Select from available instructors for each time slot
- 🚫 **Conflict Prevention** - Automatically filters out days where you already have reservations
- 📅 **Calendar Integration** - Automatically adds confirmed reservations to macOS Calendar
- 💾 **Smart Caching** - Reduces API calls with intelligent 30-minute cache
- ✨ **Modern CLI** - Clean, intuitive interface with multi-select, auto-completion, and cancellation support

### Cloudflare Worker (Automated Monitoring)

- 🔔 **Real-Time Notifications** - Get Discord alerts when new slots become available
- ⏱️ **Automatic Monitoring** - Runs every 30 minutes via cron schedule
- 🎯 **Smart Diffing** - Only notifies about genuinely new slots (not future date additions)
- 📊 **Rich Embeds** - Beautiful Discord notifications with all slot details
- 🌐 **Serverless** - Runs on Cloudflare's global edge network (free tier)
- 💰 **Cost Effective** - Well within free tier limits

> **Two Ways to Use Flight Schedule Bro:**
>
> 1. **CLI** - Interactive booking tool for your local machine
> 2. **Worker** - Automated monitoring with Discord notifications (setup instructions below)

## Prerequisites

- Node.js 18+ (for native fetch support)
- npm or yarn
- Flight Schedule Pro account with valid credentials
- macOS (for Calendar integration)

## Installation

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd flight-schedule-bro
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up environment variables:**

   Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your credentials and preferences:

   ```env
   # Flight Schedule Pro Credentials (REQUIRED)
   FSP_EMAIL=your-email@example.com
   FSP_PASSWORD=your-password-here

   # Scheduling Configuration (CLI only — worker uses wrangler.toml)
   DAYS_AHEAD=60
   AIRCRAFT_REGEX=N65411|N737BC

   # Timing Preferences (OPTIONAL - defaults shown)
   TIMEZONE=America/Los_Angeles
   WEEKDAY_MIN_HOUR=15
   MAX_HOUR=19
   ```

4. **Build the project:**
   ```bash
   npm run build
   ```

## Usage

### Running the Scheduler

```bash
npm start
```

### Interactive Workflow

1. **Authentication** - Automatically logs in with your credentials
2. **Activity Type Selection** - Choose activity type (defaults to "dual")
3. **Availability Search** - Searches for available time slots based on your preferences
4. **Time Slot Selection** - Multi-select interface to choose desired time slots
5. **Aircraft Selection** - If multiple aircraft available, choose your preference
6. **Instructor Selection** - Select from available instructors for each slot
7. **Confirmation** - Review and confirm all bookings
8. **Calendar Integration** - Reservations automatically added to macOS Calendar

### Example Session

```
🔐 Logging in...
Logged in!

✅ Found 127 bookable results!
✅ Found 42 available time slots!

? Select time slots to book
  Mon 11/4     │ 5 PM - 7 PM         │ N65411         │ Doug Libal
❯◯ Wed 11/6     │ 5 PM - 7 PM         │ N734UZ         │ Jason Hull
 ◯ Thu 11/7     │ 5 PM - 7 PM         │ N734UZ         │ Jason Hull
 ◯ Fri 11/8     │ 11 AM - 1 PM        │ N65411         │ Doug Libal

🕐 Processing time slot: Wed 11/6 5 PM - 7 PM
✔ Select aircraft for Wed 11/6 5 PM - 7 PM › N734UZ
✔ Select instructor for Wed 11/6 5 PM - 7 PM (N734UZ) › Jason Hull

📝 Confirm booking: Wed 11/6 5 PM - 7 PM with Jason Hull (N734UZ)
✔ Proceed? › Yes

✅ Successfully booked reservation!
📅 Added to Calendar!
```

## Configuration

### Environment Variables

#### CLI (`.env`)

| Variable              | Required | Default              | Description                                               |
| --------------------- | -------- | -------------------- | --------------------------------------------------------- |
| `FSP_EMAIL`           | ✅ Yes   | -                    | Your Flight Schedule Pro email                            |
| `FSP_PASSWORD`        | ✅ Yes   | -                    | Your Flight Schedule Pro password                         |
| `DAYS_AHEAD`          | No       | 60                   | Days ahead to search (today + N)                          |
| `AIRCRAFT_REGEX`      | No       | (see `.env.example`) | Regex pattern for aircraft tail numbers                   |
| `INSTRUCTOR_REGEX`    | No       | Doug Libal           | Default instructor pick pattern (CLI)                     |
| `TIMEZONE`            | No       | America/Los_Angeles  | Operator IANA timezone                                    |
| `WEEKDAY_MIN_HOUR`    | No       | 15                   | Earliest booking hour on weekdays (24h)                   |
| `MAX_HOUR`            | No       | 19                   | Latest booking hour (24h)                                 |
| `RESERVATION_TYPE_ID` | No       | -                    | Optional UUID to override monitoring/CLI reservation type |

#### Worker (`wrangler.toml` `[vars]` + secrets)

The worker does **not** use `DAYS_AHEAD`. Each cron run fetches schedule days sequentially until the Cloudflare subrequest budget is exhausted.

| Variable                        | Required        | Default             | Description                                                                   |
| ------------------------------- | --------------- | ------------------- | ----------------------------------------------------------------------------- |
| `FSP_EMAIL`                     | ✅ Yes (secret) | -                   | Flight Schedule Pro email                                                     |
| `FSP_PASSWORD`                  | ✅ Yes (secret) | -                   | Flight Schedule Pro password                                                  |
| `DISCORD_WEBHOOK_URL`           | ✅ Yes (secret) | -                   | Discord webhook for notifications                                             |
| `AIRCRAFT_REGEX`                | No              | see `wrangler.toml` | Aircraft tail numbers to monitor                                              |
| `TIMEZONE`                      | No              | America/Los_Angeles | Operator IANA timezone                                                        |
| `WEEKDAY_MIN_HOUR` / `MAX_HOUR` | No              | 15 / 19             | Valid slot hour window                                                        |
| `NOTIFICATION_AIRCRAFT`         | No              | -                   | Comma-separated tail numbers; empty = all                                     |
| `RESERVATION_TYPE_ID`           | No              | -                   | Optional monitoring reservation type UUID                                     |
| `MAX_DAYS_AHEAD`                | No              | (none)              | Cap days searched (today + N) even if budget remains                          |
| `WORKERS_PAID_PLAN`             | No              | false               | Set `"true"` on Workers Paid so KV counts toward the unified subrequest limit |

On **Workers Free**, expect ~40+ days of lookahead when schedule pages/day ≈ 1 (50 external subrequests minus auth/reservations/Discord overhead).

### Aircraft Regex Examples

```env
# Single aircraft model
AIRCRAFT_REGEX=172S

# Multiple aircraft models (OR)
AIRCRAFT_REGEX=172S|172N

# Specific callsigns
AIRCRAFT_REGEX=N65411|N734UZ

# Any 172 variant
AIRCRAFT_REGEX=172.*
```

## Development

### Project Structure

```
better-scheduler/
├── src/
│   ├── cli/              # CLI entry point and file cache
│   ├── worker/           # Cloudflare Worker (cron, KV, Discord)
│   └── shared/
│       ├── blo/          # Scheduling and availability logic
│       ├── dao/          # Flight Schedule Pro API clients
│       └── util/         # Config, dates, subrequest budget, etc.
├── scripts/
│   └── worker-sanity.ts  # Local worker search test (uses .env)
├── .env                  # CLI environment variables (not in git)
├── .env.example          # CLI environment template
├── .dev.vars.example     # Worker secrets template for wrangler dev
├── wrangler.toml         # Worker config, cron, KV, [vars]
├── package.json
└── vitest.config.ts
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

### Building

```bash
# Development build
npm run build

# Run without building
npm run exec
```

## How It Works

### 1. Authentication

- Logs in to Flight Schedule Pro using provided credentials
- Retrieves session tokens and operator details
- Caches authentication for the session

### 2. Availability Search

- Fetches aircraft, instructors, and reservation types
- Uses the FSP **Schedule v2 grid** (`POST /api/v2/schedule`) per day and computes bookable gaps from the snapshot
- **CLI:** parallel day fetches up to `DAYS_AHEAD`; optional duration 60/90/120 minutes
- **Worker:** sequential day fetches until the subrequest budget (or `MAX_DAYS_AHEAD`) is reached
- Caches FSP responses (CLI: 30-minute file cache; schedule pages: 5-minute TTL)

### 3. Smart Filtering

- **Time-based filtering**: Only shows slots within your preferred hour window (`WEEKDAY_MIN_HOUR`–`MAX_HOUR`)
- **Conflict prevention**: Filters out any days where you already have a reservation
- **Aircraft/instructor matching**: Regex filters and interactive selection narrow results

### 4. Booking Process

- Interactive multi-select for time slots
- Aircraft selection if multiple options available
- Instructor selection if multiple options available
- Confirmation before booking
- Automatic calendar integration after successful booking

### 5. Calendar Integration

- Fetches iCal data from Flight Schedule Pro
- Creates temporary .ics file
- Opens macOS Calendar with the event
- Cleans up temporary file after 5 seconds

## Troubleshooting

### Authentication Issues

**Problem:** "Failed to authenticate"

- Verify `FSP_EMAIL` and `FSP_PASSWORD` are correct in `.env`
- Check if your account has access to the operator
- Ensure your password doesn't contain special characters that need escaping

### No Availability Found

**Problem:** "No availability found for the specified criteria"

- Try increasing `DAYS_AHEAD` to search further in the future
- Adjust `WEEKDAY_MIN_HOUR`/`MAX_HOUR` for more flexible timing
- Check if `AIRCRAFT_REGEX` matches available aircraft
- Verify instructors have availability in your time range

### API Rate Limiting

**Problem:** Too many requests or slow performance

- FSP calls go through a queued `safeFetch()` with exponential backoff on 429/5xx
- CLI caches responses for 30 minutes; schedule page cache TTL is 5 minutes
- If the CLI search is slow, reduce `DAYS_AHEAD`
- Worker lookahead is automatic on Free plan; use `MAX_DAYS_AHEAD` to cap it

### Calendar Integration Not Working

**Problem:** Calendar event not appearing

- Ensure you're running on macOS
- Check that Calendar app is installed
- Verify network access for iCal fetching
- Check console for error messages

## Security

⚠️ **Important Security Notes:**

- Never commit your `.env` file to version control
- The `.env` file contains sensitive credentials
- Keep your `FSP_PASSWORD` secure and rotate it regularly
- Use a strong, unique password for your Flight Schedule Pro account

## Testing

Run tests with:

```bash
npm test
```

## Technologies

- **TypeScript** - Type-safe JavaScript
- **Node.js 18+** - Runtime with native fetch
- **Zod** - Schema validation
- **Inquirer.js** - Interactive CLI prompts
- **Vitest** - Fast unit testing framework
- **date-fns** - Date manipulation utilities

## Cloudflare Worker Setup

Want automated notifications when new flight slots open up? Deploy the Cloudflare Worker!

This repo is set up so each person can deploy their own worker, KV namespace, and Discord webhook. The only shared code lives here; the Cloudflare resources and secrets should be created in your own account.

### 1. Install Wrangler and authenticate

```bash
npm install
npx wrangler login
```

### 2. Create your own KV namespaces

Create both the production and preview namespaces:

```bash
npx wrangler kv namespace create FSP_AVAILABILITY_KV
npx wrangler kv namespace create FSP_AVAILABILITY_KV --preview
```

Copy the returned `id` and `preview_id` values into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "FSP_AVAILABILITY_KV"
id = "replace-with-your-production-kv-id"
preview_id = "replace-with-your-preview-kv-id"
```

### 3. Configure local worker development

For local `wrangler dev`, copy the example vars file and fill in your own values:

```bash
cp .dev.vars.example .dev.vars
```

Set these values in `.dev.vars`:

- `FSP_EMAIL`
- `FSP_PASSWORD`
- `DISCORD_WEBHOOK_URL`

### 4. Configure worker secrets in Cloudflare

These secrets stay out of git and are stored in your Cloudflare Worker environment:

```bash
npx wrangler secret put FSP_EMAIL
npx wrangler secret put FSP_PASSWORD
npx wrangler secret put DISCORD_WEBHOOK_URL
```

### 5. Review non-secret worker config

The `[vars]` block in `wrangler.toml` contains safe defaults you can customize:

- `AIRCRAFT_REGEX`, `TIMEZONE`, `WEEKDAY_MIN_HOUR`, `MAX_HOUR`
- `NOTIFICATION_AIRCRAFT` — limit Discord alerts to specific tail numbers
- `MAX_DAYS_AHEAD` — optional cap on days searched (useful on Workers Paid)
- `WORKERS_PAID_PLAN` — set `"true"` if you upgrade to Workers Paid

### 6. Test the search locally (optional)

Run the worker schedule search against FSP using your `.env` credentials (no KV or Discord):

```bash
npm run worker:sanity
```

### 7. Deploy your worker

```bash
npm run worker:deploy
```

### 8. Initialize the worker state

After deploy, call the setup endpoint once to create the initial snapshot (or re-run after upgrading from an older snapshot format), then warm the metadata cache:

```bash
curl https://your-worker.workers.dev/setup
curl https://your-worker.workers.dev/refresh-metadata
```

### 9. Verify it is working

Useful commands once the worker is deployed:

```bash
npm run worker:tail
npm run worker:dev
```

The cron schedule in `wrangler.toml` runs every 30 minutes. Each run fetches as many schedule days as the subrequest budget allows, compares against the previous KV snapshot, and sends a Discord notification only for newly opened slots within the previously tracked window (`trackedThroughDate`).

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Support

For issues or questions:

- Check the Troubleshooting section above
- Review existing issues on GitHub
- Create a new issue with detailed information
