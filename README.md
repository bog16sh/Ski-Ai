# AI Frontdesk

AI Frontdesk is a local-first Next.js voice concierge for ski rental bookings. It listens to guests, asks for missing booking details, stores completed bookings in PostgreSQL, and plays an instant local Bella voice pack for the greeting and follow-up prompts.

## What is in the app

- Voice booking flow in `app/page.tsx`
- Concierge API backed by local Ollama in `app/api/concierge/route.ts`
- Booking persistence in PostgreSQL through `lib/bookings.ts` and `lib/db.ts`
- Free local Kokoro voice pack in `public/voice-pack/bella`

## Project layout

`app/`
: Next.js UI and API routes.

`db/`
: PostgreSQL schema used by the bookings table.

`lib/`
: Shared booking and voice helpers.

`public/`
: Background video and committed local voice assets.

`scripts/`
: Local database and voice generation utilities.

## Local setup

1. Install dependencies:

   `npm install`

2. Create a local env file from the example:

   `cp .env.example .env.local`

3. Update `DATABASE_URL` with your local PostgreSQL password.

4. Make sure Ollama is running locally:

   `ollama serve`

5. Start or update the bookings database:

   `npm run db:migrate`

6. Start the app:

   `npm run dev`

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` starts the app
- `npm run build` creates a production build
- `npm run db:migrate` creates the database and applies `db/schema.sql`
- `npm run db:list` prints recent bookings from PostgreSQL
- `npm run voice:generate -- --force` regenerates the committed Bella voice pack

## Environment variables

`DATABASE_URL`
: Local PostgreSQL connection string.

`OLLAMA_BASE_URL`
: Ollama server URL. Defaults to `http://127.0.0.1:11434`.

`OLLAMA_MODEL`
: Ollama model name. Defaults to `llama3.2:latest`.

## Notes

- The repo already includes the current local Bella voice pack used by the app.
- Completed bookings are available at `GET /api/bookings` and in DBeaver through the `bookings` table.
