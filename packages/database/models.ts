import dotenv from 'dotenv'
dotenv.config()
import {Pool} from 'pg' 

// console.log({
// //   host: process.env.POSTGRES_HOST,
// //   port: process.env.POSTGRES_PORT,
// //   user: process.env.POSTGRES_USER,
// //   password: process.env.POSTGRES_PASSWORD,
// //   passwordType: typeof process.env.POSTGRES_PASSWORD,
// //   db: process.env.POSTGRES_DB,
// // })

export const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 20,
    idleTimeoutMillis: 30000,
});

// user model operations
export const UserModel = {
    async create(userData: {
        email: string;
        phone: string;
        full_name: string
        role: 'rider' | 'driver' | 'admin'
        password_hash: string
    }) {
        const query = `
        INSERT INTO users (email, phone, full_name, role, password_hash)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, email, phone, full_name, role, is_active, created_at`;

        const values = [userData.email, userData.phone, userData.full_name, userData.role, userData.password_hash];
        const result = await pool.query(query, values);
        return result.rows[0];
    },

    async findByEmail(email: string) {
        const query = `SELECT * FROM users WHERE email = $1`;
        const result = await pool.query(query, [email]);
         return result.rows[0];
    },

    async findByPhone(phone: string) {
        const query = `SELECT * FROM users WHERE phone = $1`;
        const result = await pool.query(query, [phone])
        return result.rows[0]
    },

    async findById(userId: string) {
        const query = `
            SELECT u.*, 
                   dp.vehicle_model, dp.vehicle_plate, dp.is_approved as driver_approved,
                   dp.current_status as driver_status
            FROM users u
            LEFT JOIN driver_profiles dp ON u.id = dp.user_id
            WHERE u.id = $1
        `;
        const result = await pool.query(query, [userId]);
        return result.rows[0];
    },

    async updateLastLogin(userId: string) {
        const query = `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`;
        await pool.query(query, [userId]);
    },

    async getAllUsers(params: {
        limit?: number;
        offset?: number;
        role?: 'rider' | 'driver' | 'admin' | 'all';
        search?: string;
        isActive?: boolean;
    } = {}) {
        const { limit = 20, offset = 0, role = 'all', search = '', isActive } = params;

        let query = `
            SELECT u.*,
                   dp.vehicle_model,
                   dp.vehicle_plate,
                   dp.vehicle_color,
                   dp.license_plate,
                   dp.is_approved
            FROM users u
            LEFT JOIN driver_profiles dp ON u.id = dp.user_id
            WHERE 1=1
        `;

        const values: any[] = [];
        let paramCount = 1;

        // Role filter
        if (role !== 'all') {
            query += ` AND u.role = $${paramCount}`;
            values.push(role);
            paramCount++;
        }

        // Active status filter
        if (typeof isActive === 'boolean') {
            query += ` AND u.is_active = $${paramCount}`;
            values.push(isActive);
            paramCount++;
        }

        // Search filter (email, phone, full_name)
        if (search) {
            query += ` AND (u.full_name ILIKE $${paramCount} OR u.email ILIKE $${paramCount} OR u.phone ILIKE $${paramCount})`;
            values.push(`%${search}%`);
            paramCount++;
        }

        // Count total records
        const countQuery = `SELECT COUNT(*) FROM (${query}) AS sub`;
        const countResult = await pool.query(countQuery, values);
        const total = parseInt(countResult.rows[0].count);

        // Add pagination
        query += ` ORDER BY u.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        values.push(limit, offset);

        const result = await pool.query(query, values);

        return {
            users: result.rows,
            total
        };
    }
}

export const DriverModel = {
    async createProfile(driverData: {
        user_id: string;
        vehicle_model: string;
        vehicle_plate: string;
        vehicle_color: string;
        license_plate: string;
    }) {
        const query = `
            INSERT INTO driver_profiles (user_id, vehicle_model, vehicle_plate, vehicle_color, license_plate)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const result = await pool.query(query, [
            driverData.user_id,
            driverData.vehicle_model,
            driverData.vehicle_plate,
            driverData.vehicle_color,
            driverData.license_plate,
        ]);
        return result.rows[0];
    },

     async updateStatus(driverId: string, status: 'offline' | 'online' | 'on_ride') {
        const query = `UPDATE driver_profiles SET current_status = $1 WHERE user_id = $2 RETURNING *`;
        const result = await pool.query(query, [status, driverId]);
        return result.rows[0];
    },

    async uploadDocument(docData: {
        driver_id: string;
        document_type: string;
        document_url: string;
    }) {
        const query = `
            INSERT INTO driver_documents (driver_id, document_type, document_url)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const result = await pool.query(query, [
            docData.driver_id,
            docData.document_type,
            docData.document_url,
        ]);
        return result.rows[0];
    },

    async getDocuments(driverId: string) {
        const query = `SELECT * FROM driver_documents WHERE driver_id = $1 ORDER BY uploaded_at DESC`;
        const result = await pool.query(query, [driverId]);
        return result.rows;
    },
};

// Auth token operations
export const AuthTokenModel = {
    async saveToken(tokenData: {
        user_id: string;
        token_type: 'access' | 'refresh';
        token_hash: string;
        expires_at: Date;
        user_agent?: string;
        ip_address?: string;
    }) {
        const query = `
            INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at, user_agent, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `;
        const result = await pool.query(query, [
            tokenData.user_id,
            tokenData.token_type,
            tokenData.token_hash,
            tokenData.expires_at,
            tokenData.user_agent,
            tokenData.ip_address,
        ]);
        return result.rows[0];
    },

    async revokeToken(tokenHash: string) {
        const query = `UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1`;
        await pool.query(query, [tokenHash]);
    },

    async revokeAllUserTokens(userId: string) {
        const query = `UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL`;
        await pool.query(query, [userId]);
    },
};
