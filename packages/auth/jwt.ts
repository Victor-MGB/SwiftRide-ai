import dotenv from 'dotenv'
dotenv.config()

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { redis } from '../redis/client';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || ''
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || '';
const ACCESS_TOKEN_EXPIRY = '15m'; 
const REFRESH_TOKEN_EXPIRY = '7d'; 

export interface TokenPayload {
    userId: string;
    email: string;
    role: 'rider' | 'driver' | 'admin'
}

// access token generation
export function generateAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRY
    });
}

// refresh token generation
export function generateRefreshToken(payload: TokenPayload): string{
    return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
        expiresIn: REFRESH_TOKEN_EXPIRY
    })
}

// verify access token
export function verifyAccessToken(token: string): TokenPayload | null {
    try {
        const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as TokenPayload;
        return decoded
    } catch (error) {
        return null
    }
}

// verify refresh token
export function verifyRefreshToken(token: string): TokenPayload | null {
    try {
        const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET) as TokenPayload;
        return decoded;
    } catch (error) {
        return null;
    }
}

// hash token
export function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// blacklist access token logout
export async function blacklistToken(token: string, expirySecond: number): Promise<void> {
    const hashedToken = hashToken(token);
    await redis.setex(`blacklist: ${hashedToken}`, expirySecond, 'revoked');
}

// check if token is blacklisted
export async function isTokenBlacklisted(token: string): Promise<boolean> {
    const hashedToken = hashToken(token);
    const result = await redis.get(`blacklist:${hashedToken}`);
    return result !== null;
}

// store refresh token
export async function storeRefreshToken(userId: string, tokenId: string, tokenHash: string, expirySeconds: number): Promise<void> {
    await redis.hset(`refresh_tokens:${userId}`, tokenId, tokenHash);
    await redis.expire(`refresh_tokens:${userId}`, expirySeconds);
}

// revoke all token for a user
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
    await redis.del(`refresh_token:${userId}`);
}