import { Queue, Worker } from 'bullmq';
import { redis } from './redis.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Create the booking queue
export const bookingQueue = new Queue('booking-timeout-queue', {
    connection: redis
});

// Setup the worker to process delayed jobs
const worker = new Worker('booking-timeout-queue', async (job) => {
    const { seatId } = job.data;
    console.log(`Processing timeout for seatId: ${seatId}`);

    // Need a transaction to safely rollback seat if it hasn't been booked
    // Raw SQL is used to enforce pessimistic read locks (SELECT ... FOR UPDATE)
    await prisma.$transaction(async (tx) => {
        // Lock the seat row
        const seats = await tx.$queryRaw`
      SELECT id, status FROM "Seat"
      WHERE id = ${seatId}
      FOR UPDATE
    `;

        if (seats.length === 0) return;
        const seat = seats[0];

        // If it's still pending after the timeout, revert it
        if (seat.status === 'PENDING') {
            console.log(`Seat ${seatId} still pending. Reverting to AVAILABLE.`);
            await tx.$executeRaw`
        UPDATE "Seat"
        SET status = 'AVAILABLE', "userId" = NULL, "lockedAt" = NULL
        WHERE id = ${seatId}
      `;

            // Since status changed, drop the cache
            await redis.del('seats_layout');
        } else {
            console.log(`Seat ${seatId} already confirmed or altered (status: ${seat.status}). No action taken.`);
        }
    });

}, { connection: redis });

worker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed with error ${err.message}`);
});
