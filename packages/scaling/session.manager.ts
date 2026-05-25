import { redis } from '../redis/client';
import crypto from 'crypto';

export class SessionManager {
    // Store session in Redis (shared across instances)
    static async setSession(userId: string, data: any, ttlSeconds: number = 3600): Promise<void> {
        const sessionKey = `session:${userId}`;
        await redis.setex(sessionKey, ttlSeconds, JSON.stringify(data));
    }
    
    static async getSession(userId: string): Promise<any> {
        const sessionKey = `session:${userId}`;
        const data = await redis.get(sessionKey);
        return data ? JSON.parse(data) : null;
    }
    
    // Generate request ID for tracing across services
    static generateRequestId(): string {
        return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    }
    
    // Track request across distributed systems
    static async trackRequest(requestId: string, metadata: any): Promise<void> {
        await redis.xadd('stream:requests', '*', 
            'requestId', requestId,
            'timestamp', Date.now().toString(),
            'metadata', JSON.stringify(metadata)
        );
    }
}

// Make WebSocket manager stateless with Redis
export class StatelessWebSocketManager {
    private static readonly USER_SOCKET_MAP = 'user:socket:mapping';
    
    // Register socket connection (shared across servers)
    static async registerSocket(userId: string, socketId: string, serverId: string): Promise<void> {
        await redis.hset(this.USER_SOCKET_MAP, userId, JSON.stringify({
            socketId,
            serverId,
            connectedAt: Date.now()
        }));
        await redis.expire(this.USER_SOCKET_MAP, 3600);
    }
    
    static async unregisterSocket(userId: string): Promise<void> {
        await redis.hdel(this.USER_SOCKET_MAP, userId);
    }
    
    static async getUserSocket(userId: string): Promise<{ socketId: string; serverId: string } | null> {
        const data = await redis.hget(this.USER_SOCKET_MAP, userId);
        return data ? JSON.parse(data) : null;
    }
    
    static async broadcastToUser(userId: string, event: string, data: any): Promise<void> {
        const socketInfo = await this.getUserSocket(userId);
        if (socketInfo) {
            // Publish to Redis channel for the specific server to handle
            await redis.publish(`server:${socketInfo.serverId}:user:${userId}`, JSON.stringify({
                event,
                data
            }));
        }
    }
}