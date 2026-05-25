import { Router, Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { rateLimit } from '../../../../packages/redis/client';
import { UserModel } from '../../../../packages/database/models';
import { authenticate } from '../middleware/auth.middleware';
const router = Router();

// Rate limiting for auth endpoints
const authLimiter = async (req: Request, res: Response, next: any) => {
    // Skip rate limiting during load tests
    if (process.env.LOAD_TEST === 'true' || process.env.NODE_ENV === 'test') {
        return next();
    }
    
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const allowed = await rateLimit(`auth:${ip}`, 'auth', 10, 60); // 10 requests per minute
    
    if (!allowed) {
        res.status(429).json({ error: 'Too many authentication attempts. Please try again later.' });
        return;
    }
    next();
};

// Rider Signup
router.post('/signup/rider', authLimiter, async (req: Request, res: Response) => {
    try {
        const { email, phone, fullName, password } = req.body;
        
        // Validation
        if (!email || !phone || !fullName || !password) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        if (password.length < 8) {
            res.status(400).json({ error: 'Password must be at least 8 characters' });
            return;
        }

        const result = await AuthService.riderSignup({
            email,
            phone,
            fullName,
            password,
        });

        res.status(201).json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Driver Signup (Onboarding)
router.post('/signup/driver', authLimiter, async (req: Request, res: Response) => {
    try {
        const {
            email,
            phone,
            fullName,
            password,
            vehicleModel,
            vehiclePlate,
            vehicleColor,
            licensePlate,
        } = req.body;

        // Validation
        if (!email || !phone || !fullName || !password || !vehicleModel || !vehiclePlate || !licensePlate) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        const result = await AuthService.driverSignup({
            email,
            phone,
            fullName,
            password,
            vehicleModel,
            vehiclePlate,
            vehicleColor,
            licensePlate,
        });

        res.status(201).json(result);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            res.status(400).json({ error: 'Email and password required' });
            return;
        }

        const userAgent = req.get('user-agent');
        const ipAddress = req.ip;

        const result = await AuthService.login(email, password, userAgent, ipAddress);
        res.json(result);
    } catch (error: any) {
        res.status(401).json({ error: error.message });
    }
});

// Refresh Token
router.post('/refresh', authLimiter, async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            res.status(400).json({ error: 'Refresh token required' });
            return;
        }

        const result = await AuthService.refreshToken(refreshToken);
        res.json(result);
    } catch (error: any) {
        res.status(401).json({ error: error.message });
    }
});

// Logout
router.post('/logout', async (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;
        const accessToken = authHeader?.split(' ')[1];
        const { refreshToken } = req.body;

        if (accessToken) {
            await AuthService.logout(accessToken, refreshToken);
        }

        res.json({ message: 'Logged out successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get current user
router.get('/me', authenticate, async (req: Request, res: Response) => {
    try {
        // User would be set by auth middleware
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const user = await UserModel.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({ user });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;