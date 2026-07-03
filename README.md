# High-Concurrency Ticket Booking System

A distributed, fully-featured, race-condition-immune Ticket Booking engine and Live Simulator.

This system demonstrates how to securely handle high-concurrency flash-sales for events/tickets without succumbing to double-bookings or phantom reads, utilizing real-time database-level pessimistic locking and queue-based auto-rollbacks.

## Tech Stack
* **Frontend:** React + Vite
* **Backend API:** Node.js + Express
* **Database Management:** Prisma ORM
* **Relational Core:** PostgreSQL 15 (Leveraging `SELECT ... FOR UPDATE` Locks)
* **Message Broker / Cache:** Redis 7 
* **State Machine Queue:** BullMQ

## How It Works Under The Hood

1. **Idempotency checks:** Every network request from the client provides an `idempotency-key`. Redis checks this immediately to guarantee zero double-charges from network jitters (e.g., impatient users repeatedly clicking).
2. **Pessimistic Row-Level Locks:** If 1,000 users click the same exact seat at the same millisecond, PostgreSQL physically locks that distinct row via Prisma's `$queryRaw FORMAT` parameters. One transaction slips through, while all others block.
3. **Queue Rollbacks:** When a seat is successfully marked as `PENDING`, a background BullMQ `Worker` fires on a 30-second delay. If a webhook payment is not received confirming the seat as `BOOKED`, the Worker automatically wipes the pending status and refunds the seat to the `AVAILABLE` pool.
4. **Cache-Aside Pattern:** The Seat Map aggressively utilizes Redis to read state in sub-milliseconds rather than crippling the SQL database.

---

## 🛠️ Local Development Setup

### 1. Boot up the Infrastructure
Ensure Docker is installed on your machine. Start the PostgreSQL and Redis containers:
```bash
docker-compose up -d
```

### 2. Configure the Backend (Server)
Start a new terminal and initialize the Node.js API server:
```bash
cd server
npm install

# Push the schema constraints to Postgres & seed the database with mock seats
npx prisma db push
node prisma/seed.js

# Start the server (runs on port 5000)
npm run dev
```

### 3. Configure the Frontend (Client)
Start a separate terminal for the React UI:
```bash
cd client
npm install

# Start the client (runs on port 5173 by default)
npm run dev
```

### 4. Run the Application
Open your browser and navigate to `http://localhost:5173`. 

---

## 🔬 Testing the Race Conditions

The local dashboard comes with a built-in **Concurrency Simulator**:
1. Select a target seat in the Control Panel dropdown.
2. Click **Fire Concurrent Load Test**.
3. Watch the **Live HTTP Tracker** on the right side. The UI natively launches 5 parallel Promises against the Backend simultaneously. 
4. The Tracker will display the exact Millisecond Latency waterfall. You will see Postgres naturally admit the first network ping (`200 LOCKED`), and subsequently safely block and discard the remaining 4 parallel requests gracefully with strict HTTP `409` rejections.
