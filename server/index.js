import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { redis } from './redis.js';
import { bookingQueue } from './queue.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const prisma = new PrismaClient();

app.use(cors());

app.use(express.json());

// Basic health route
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is healthy' });
});

// GET /api/seats (Cache-Aside pattern)
app.get('/api/seats', async (req, res) => {
    try {
        // 1. Check Redis Cache
        const cachedSeats = await redis.get('seats_layout');
        if (cachedSeats) {
            return res.json({ source: 'cache', data: JSON.parse(cachedSeats) });
        }

        // 2. Cache Miss: Query PostgreSQL
        const seats = await prisma.seat.findMany({
            orderBy: { seatNumber: 'asc' }
        });

        // 3. Save to Redis Cache (TTL: 60 seconds)
        await redis.setex('seats_layout', 60, JSON.stringify(seats));

        return res.json({ source: 'db', data: seats });
    } catch (error) {
        console.error('Error fetching seats', error);
        res.status(500).json({ error: 'Failed to fetch seats' });
    }
});

// POST /api/book (High Concurrency & Pessimistic Locking)
app.post('/api/book', async (req, res) => {
    const { seatId, userId } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];

    if (!seatId || !userId || !idempotencyKey) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
        // 1. Check Idempotency (Prevent double clicks/retries)
        const hasBeenProcessed = await redis.setnx(`idempotency:${idempotencyKey}`, 'processing');
        if (hasBeenProcessed === 0) {
            return res.status(409).json({ error: 'Duplicate request detected' });
        }
        // Set a short TTL on the idempotency key (10 minutes)
        await redis.expire(`idempotency:${idempotencyKey}`, 600);

        // 2. Perform Transaction with Row-Level Lock
        const result = await prisma.$transaction(async (tx) => {
            // Pessimistic Write Lock: Blocks other transactions reading this row for update
            const seats = await tx.$queryRaw`
        SELECT id, status FROM "Seat"
        WHERE id = ${parseInt(seatId)}
        FOR UPDATE
      `;

            if (seats.length === 0) {
                throw new Error('Seat not found');
            }

            const seat = seats[0];

            if (seat.status !== 'AVAILABLE') {
                throw new Error(`Seat is currently ${seat.status}`);
            }

            // 3. Book the seat (PENDING)
            const updatedSeat = await tx.$executeRaw`
        UPDATE "Seat"
        SET status = 'PENDING', "userId" = ${userId}, "lockedAt" = ${new Date()}
        WHERE id = ${parseInt(seatId)}
      `;

            return updatedSeat;
        });

        // 4. Invalidate Cache
        await redis.del('seats_layout');

        // 5. Fire background worker job to rollback if not confirmed within 30 seconds
        const delayMs = 30000; // 30 seconds for testability
        await bookingQueue.add('booking-timeout', { seatId: parseInt(seatId) }, { delay: delayMs });

        return res.json({ message: 'Seat locked. Payment pending.', status: 'PENDING', seatId });
    } catch (error) {
        if (error.message.includes('Seat is currently')) {
            return res.status(409).json({ error: error.message });
        }
        if (error.message === 'Seat not found') {
            return res.status(404).json({ error: error.message });
        }
        console.error('Booking failed', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/confirm (Payment Webhook Mock)
app.post('/api/confirm', async (req, res) => {
    const { seatId, userId } = req.body;

    try {
        const updatedCount = await prisma.seat.updateMany({
            where: {
                id: parseInt(seatId),
                userId: userId,
                status: 'PENDING'
            },
            data: {
                status: 'BOOKED'
            }
        });

        if (updatedCount.count === 0) {
            return res.status(400).json({ error: 'Booking confirmation failed. Link expired or invalid state.' });
        }

        // Invalidate Cache
        await redis.del('seats_layout');

        res.json({ message: 'Booking confirmed!', status: 'BOOKED', seatId });
    } catch (error) {
        console.error('Confirm error', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/reset (Reset all seats for testing)
app.post('/api/reset', async (req, res) => {
    try {
        await prisma.seat.updateMany({
            data: {
                status: 'AVAILABLE',
                userId: null,
                lockedAt: null
            }
        });

        // Invalidate Cache
        await redis.del('seats_layout');

        res.json({ message: 'All seats have been reset to AVAILABLE.', status: 'ok' });
    } catch (error) {
        console.error('Reset error', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
