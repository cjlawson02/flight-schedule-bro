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

   # Scheduling Configuration
   DAYS_AHEAD=60                    # How many days ahead to search
   AIRCRAFT_REGEX=172S|172N         # Aircraft models to search (regex pattern)

   # Timing Preferences (OPTIONAL - defaults shown)
   WEEKDAY_MIN_HOUR=15             # Earliest hour on weekdays (3 PM)
   MAX_HOUR=19             # Latest hour on weekdays (7 PM)
   WEEKEND_MIN_HOUR=8              # Earliest hour on weekends (8 AM)
   WEEKEND_MAX_HOUR=19             # Latest hour on weekends (7 PM)
   MIN_BLOCK_HOURS=2               # Minimum flight duration in hours
   MAX_BLOCK_HOURS=3               # Maximum flight duration in hours
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

| Variable           | Required | Default | Description                             |
| ------------------ | -------- | ------- | --------------------------------------- |
| `FSP_EMAIL`        | ✅ Yes    | -       | Your Flight Schedule Pro email          |
| `FSP_PASSWORD`     | ✅ Yes    | -       | Your Flight Schedule Pro password       |
| `DAYS_AHEAD`       | ✅ Yes    | -       | Days ahead to search (e.g., 60)         |
| `ACTIVITY_TYPE`    | ✅ Yes    | -       | Activity type ID or name (e.g., "dual") |
| `AIRCRAFT_REGEX`   | ✅ Yes    | -       | Regex pattern for aircraft callsigns    |
| `WEEKDAY_MIN_HOUR` | No       | 15      | Earliest booking hour on weekdays (24h) |
| `MAX_HOUR`         | No       | 19      | Latest booking hour on weekdays (24h)   |
| `WEEKEND_MIN_HOUR` | No       | 8       | Earliest booking hour on weekends (24h) |
| `WEEKEND_MAX_HOUR` | No       | 19      | Latest booking hour on weekends (24h)   |
| `MIN_BLOCK_HOURS`  | No       | 2       | Minimum flight duration (hours)         |
| `MAX_BLOCK_HOURS`  | No       | 3       | Maximum flight duration (hours)         |

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
flight-schedule-bro/
├── src/
│   ├── blo/              # Business Logic Objects
│   │   ├── calendar.ts   # Calendar integration logic
│   │   └── scheduler.ts  # Scheduling business logic
│   ├── dao/              # Data Access Objects
│   │   ├── aircraft.ts   # Aircraft data access
│   │   ├── api_wrapper.ts # API wrapper with caching/retry
│   │   ├── auth.ts       # Authentication
│   │   ├── availability.ts # Availability search
│   │   ├── calendar.ts   # Calendar API access
│   │   ├── existingReservations.ts # Existing reservation checks
│   │   ├── instructors.ts # Instructor data access
│   │   ├── reservations.ts # Reservation booking
│   │   └── reservationTypes.ts # Reservation type data
│   ├── util/             # Utility modules
│   │   ├── cache.ts      # File-based caching system
│   │   ├── config.ts     # Configuration management
│   │   ├── dates.ts      # Date/time utilities
│   │   └── interactive.ts # CLI user interface
│   └── index.ts          # Main entry point
├── .env                  # Environment variables (not in git)
├── .env.example          # Environment template
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
└── vitest.config.ts      # Test configuration
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
- Searches availability for each day in the configured range
- Uses chunked requests (3 instructors at a time) to avoid rate limits
- Caches results for 30 minutes to reduce API load

### 3. Smart Filtering
- **Time-based filtering**: Only shows slots within your preferred hours
- **Duration filtering**: Only shows slots matching your min/max duration
- **Conflict prevention**: Filters out any days where you already have a reservation
- **Weekday/Weekend logic**: Applies different rules for weekdays vs weekends

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
- The app automatically chunks requests (3 instructors at a time)
- Results are cached for 30 minutes
- If issues persist, reduce `DAYS_AHEAD` to search fewer days

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

The `[vars]` block in `wrangler.toml` contains safe defaults you can customize for your own setup:

- `DAYS_AHEAD`
- `AIRCRAFT_REGEX`
- `WEEKDAY_MIN_HOUR`
- `MAX_HOUR`
- `NOTIFICATION_AIRCRAFT`

### 6. Deploy your worker

```bash
npm run worker:deploy
```

### 7. Initialize the worker state

After deploy, call the setup endpoint once to create the initial snapshot, then warm the metadata cache:

```bash
curl https://your-worker.workers.dev/setup
curl https://your-worker.workers.dev/refresh-metadata
```

### 8. Verify it is working

Useful commands once the worker is deployed:

```bash
npm run worker:tail
npm run worker:dev
```

The cron schedule in `wrangler.toml` runs every 30 minutes. Each run compares the latest availability against the previous snapshot and sends a Discord notification only for newly opened slots.

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
