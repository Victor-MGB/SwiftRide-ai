import { Pool } from 'pg';
import { redis } from '../redis/client';

export class DatabaseQueryRouter {
    private primaryPool: Pool;
    private replicaPools: Pool[];
    private currentReplicaIndex = 0;
    
    constructor() {
        // Primary for writes
        this.primaryPool = new Pool({
            host: process.env.DB_PRIMARY_HOST || 'postgres-primary',
            port: parseInt(process.env.DB_PORT || '5432'),
            user: process.env.DB_USER || 'uber',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'uber_clone',
            max: 100,  // Connection pool size
            idleTimeoutMillis: 30000,
        });
        
        // Read replicas
        this.replicaPools = [
            new Pool({
                host: process.env.DB_REPLICA_1_HOST || 'postgres-replica-1',
                port: parseInt(process.env.DB_PORT || '5432'),
                user: process.env.DB_USER || 'uber',
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME || 'uber_clone',
                max: 50,
            }),
            new Pool({
                host: process.env.DB_REPLICA_2_HOST || 'postgres-replica-2',
                port: parseInt(process.env.DB_PORT || '5432'),
                user: process.env.DB_USER || 'uber',
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME || 'uber_clone',
                max: 50,
            })
        ];
    }
    
    // Route write queries to primary
    async write(query: string, params?: any[]): Promise<any> {
        const start = Date.now();
        try {
            const result = await this.primaryPool.query(query, params);
            this.recordMetric('write', Date.now() - start);
            return result;
        } catch (error) {
            console.error('Write query failed:', error);
            throw error;
        }
    }
    
    // Route read queries to replicas (round-robin)
    async read(query: string, params?: any[]): Promise<any> {
        const start = Date.now();
        
        // Check cache first
        const cacheKey = `query:${this.hashQuery(query, params)}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            this.recordMetric('read_cache_hit', Date.now() - start);
            return JSON.parse(cached);
        }
        
        // Round-robin between replicas
        const pool = this.replicaPools[this.currentReplicaIndex % this.replicaPools.length];
        this.currentReplicaIndex++;
        
        try {
            const result = await pool.query(query, params);
            
            // Cache for 5 seconds (fast-changing data)
            if (query.toLowerCase().includes('select') && !query.toLowerCase().includes('now()')) {
                await redis.setex(cacheKey, 5, JSON.stringify(result.rows));
            }
            
            this.recordMetric('read', Date.now() - start);
            return result;
        } catch (error) {
            // Fallback to primary if replica fails
            console.error('Replica query failed, falling back to primary:', error);
            const result = await this.primaryPool.query(query, params);
            return result;
        }
    }
    
    // Auto-detect query type and route
    async query(query: string, params?: any[]): Promise<any> {
        const isWrite = this.isWriteQuery(query);
        
        if (isWrite) {
            return this.write(query, params);
        } else {
            return this.read(query, params);
        }
    }
    
    private isWriteQuery(query: string): boolean {
        const upper = query.trim().toUpperCase();
        return upper.startsWith('INSERT') || 
               upper.startsWith('UPDATE') || 
               upper.startsWith('DELETE') ||
               upper.startsWith('CREATE') ||
               upper.startsWith('ALTER') ||
               upper.startsWith('DROP');
    }
    
    private hashQuery(query: string, params?: any[]): string {
        const str = query + JSON.stringify(params || []);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return `q_${Math.abs(hash)}`;
    }
    
    private recordMetric(operation: string, durationMs: number): void {
        // Track metrics for Prometheus
        console.log(`DB ${operation} took ${durationMs}ms`);
    }
    
    // Health check all databases
    async healthCheck(): Promise<boolean> {
        try {
            await this.primaryPool.query('SELECT 1');
            for (const replica of this.replicaPools) {
                await replica.query('SELECT 1');
            }
            return true;
        } catch {
            return false;
        }
    }
}

export const dbRouter = new DatabaseQueryRouter();