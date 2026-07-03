import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;

export const redis = redisUrl
    ? new Redis(redisUrl, { maxRetriesPerRequest: null })
    : new Redis({
        host: redisHost,
        port: redisPort,
        maxRetriesPerRequest: null,
    });

redis.on('error', (err) => console.error('Redis Client Error', err));
redis.on('connect', () => console.log('Connected to Redis'));
