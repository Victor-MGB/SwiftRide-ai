import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, isTokenBlacklisted, TokenPayload } from '../../../../packages/auth/jwt';

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            user?: TokenPayload;
        }
    }
}

// Authentication middleware
export async function authenticate(req: Request, res: Response, next: NextFunction) {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        const token = authHeader.split(' ')[1];
        
        // Check if token is blacklisted
        const isBlacklisted = await isTokenBlacklisted(token);
        if (isBlacklisted) {
            res.status(401).json({ error: 'Token invalidated' });
            return;
        }

        // Verify token
        const payload = verifyAccessToken(token);
        if (!payload) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        req.user = payload;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Authentication failed' });
    }
}

// Role-based authorization middleware
export function requireRole(...allowedRoles: Array<'rider' | 'driver' | 'admin'>) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        if (!allowedRoles.includes(req.user.role)) {
            res.status(403).json({ error: 'Insufficient permissions' });
            return;
        }

        next();
    };
}

export async function requireDriverApproved(req: Request, res: Response, next: NextFunction) {
    if (!req.user || req.user.role !== 'driver') {
        res.status(403).json({ error: 'Driver role required' });
        return;
    }

    // Check approval status from database
    const { UserModel } = await import('../../../../packages/database/models');
    const user = await UserModel.findById(req.user.userId);
    
    if (!user.driver_approved) {
        res.status(403).json({ error: 'Driver account not approved yet' });
        return;
    }

    next();
}