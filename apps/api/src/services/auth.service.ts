import { hashPassword, verifyPassword, generateOTP } from '../../../../packages/auth/password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, hashToken, blacklistToken, revokeAllRefreshTokens } from '../../../../packages/auth/jwt';
import { UserModel, DriverModel, AuthTokenModel, pool } from '../../../../packages/database/models';
import { redis } from '../../../../packages/redis/client';

export class AuthService {
    // Rider signup
    static async riderSignup(data: {
        email: string;
        phone: string;
        fullName: string;
        password: string;
    }) {
        // Check if user exists
        const existingUser = await UserModel.findByEmail(data.email);
        if (existingUser) {
            throw new Error('User already exists with this email');
        }

        const existingPhone = await UserModel.findByPhone(data.phone);
        if (existingPhone) {
            throw new Error('User already exists with this phone number');
        }

        // Hash password
        const passwordHash = await hashPassword(data.password);

        // Create user
        const user = await UserModel.create({
            email: data.email,
            phone: data.phone,
            full_name: data.fullName,
            role: 'rider',
            password_hash: passwordHash,
        });

        // Generate tokens
        const tokens = await this.generateTokens(user.id, user.email, 'rider');

        return {
            user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                fullName: user.full_name,
                role: user.role,
            },
            ...tokens,
        };
    }

    // Driver signup (with onboarding)
    static async driverSignup(data: {
        email: string;
        phone: string;
        fullName: string;
        password: string;
        vehicleModel: string;
        vehiclePlate: string;
        vehicleColor: string;
        licensePlate: string;
    }) {
        // Start transaction
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Check if user exists
            const existingUser = await UserModel.findByEmail(data.email);
            if (existingUser) {
                throw new Error('User already exists with this email');
            }

            // Hash password
            const passwordHash = await hashPassword(data.password);

            // Create user
            const user = await UserModel.create({
                email: data.email,
                phone: data.phone,
                full_name: data.fullName,
                role: 'driver',
                password_hash: passwordHash,
            });

            // Create driver profile
            const driverProfile = await DriverModel.createProfile({
                user_id: user.id,
                vehicle_model: data.vehicleModel,
                vehicle_plate: data.vehiclePlate,
                vehicle_color: data.vehicleColor,
                license_plate: data.licensePlate,
            });

            await client.query('COMMIT');

            // Generate tokens
            const tokens = await this.generateTokens(user.id, user.email, 'driver');

            return {
                user: {
                    id: user.id,
                    email: user.email,
                    phone: user.phone,
                    fullName: user.full_name,
                    role: user.role,
                    isApproved: driverProfile.is_approved,
                },
                driverProfile,
                ...tokens,
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

        // Admin Signup (Protected)
    static async adminSignup(data: {
        email: string;
        phone: string;
        fullName: string;
        password: string;
    }) {
        // Check if user exists
        const existingUser = await UserModel.findByEmail(data.email);
        if (existingUser) {
            throw new Error('User already exists with this email');
        }

        const existingPhone = await UserModel.findByPhone(data.phone);
        if (existingPhone) {
            throw new Error('User already exists with this phone number');
        }

        // Hash password
        const passwordHash = await hashPassword(data.password);

        // Create admin user
        const user = await UserModel.create({
            email: data.email,
            phone: data.phone,
            full_name: data.fullName,
            role: 'admin',
            password_hash: passwordHash,
        });

        // Generate tokens
        const tokens = await this.generateTokens(user.id, user.email, 'admin');

        return {
            message: "Admin account created successfully",
            user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                fullName: user.full_name,
                role: user.role,
            },
            ...tokens,
        };
    }

    // Login
    static async login(email: string, password: string, userAgent?: string, ipAddress?: string) {
        // Find user
        const user = await UserModel.findByEmail(email);
        if (!user) {
            throw new Error('Invalid credentials');
        }

        // Check if user is active
        if (!user.is_active) {
            throw new Error('Account is deactivated');
        }

        // Verify password
        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid) {
            throw new Error('Invalid credentials');
        }

        // Update last login
        await UserModel.updateLastLogin(user.id);

        // Generate tokens
        const tokens = await this.generateTokens(user.id, user.email, user.role, userAgent, ipAddress);

        return {
            user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                fullName: user.full_name,
                role: user.role,
            },
            ...tokens,
        };
    }

    // Refresh token
    static async refreshToken(refreshToken: string) {
        // Verify refresh token
        const payload = verifyRefreshToken(refreshToken);
        if (!payload) {
            throw new Error('Invalid refresh token');
        }

        // Check if token is revoked (in Redis)
        const tokenHash = hashToken(refreshToken);
        const isRevoked = await redis.get(`refresh_revoked:${tokenHash}`);
        if (isRevoked) {
            throw new Error('Token revoked');
        }

        // Get user
        const user = await UserModel.findById(payload.userId);
        if (!user || !user.is_active) {
            throw new Error('User not found or inactive');
        }

        // Generate new tokens
        const newTokens = await this.generateTokens(user.id, user.email, user.role);

        // Blacklist old refresh token
        await redis.setex(`refresh_revoked:${tokenHash}`, 7 * 24 * 3600, 'revoked');

        return newTokens;
    }

    // Logout
    static async logout(accessToken: string, refreshToken?: string) {
        // Blacklist access token
        const accessPayload = verifyRefreshToken(accessToken); // reuse verification logic
        if (accessPayload) {
            await blacklistToken(accessToken, 15 * 60); // 15 minutes expiry
        }

        // Blacklist refresh token if provided
        if (refreshToken) {
            const refreshHash = hashToken(refreshToken);
            await redis.setex(`refresh_revoked:${refreshHash}`, 7 * 24 * 3600, 'revoked');
        }
    }

    // Generate tokens and store in DB
    private static async generateTokens(userId: string, email: string, role: string, userAgent?: string, ipAddress?: string) {
        const payload = { userId, email, role: role as any };
        
        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // Store refresh token hash in DB
        const refreshHash = hashToken(refreshToken);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

        await AuthTokenModel.saveToken({
            user_id: userId,
            token_type: 'refresh',
            token_hash: refreshHash,
            expires_at: expiresAt,
            user_agent: userAgent,
            ip_address: ipAddress,
        });

        return { accessToken, refreshToken };
    }
}