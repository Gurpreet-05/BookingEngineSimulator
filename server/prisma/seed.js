import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding database with initial seats...');
    const seats = [];
    for (let i = 1; i <= 50; i++) {
        seats.push({
            seatNumber: `A${i}`,
            status: 'AVAILABLE'
        });
    }

    // Use createMany to insert seats
    await prisma.seat.createMany({
        data: seats,
        skipDuplicates: true, // Optional: skips rows that violate unique constraints
    });
    console.log('Successfully seeded 50 seats.');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
