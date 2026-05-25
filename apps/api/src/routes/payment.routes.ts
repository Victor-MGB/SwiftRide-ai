import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { PaymentService } from '../../../../packages/payment/payment.service';
import { RideLifecycleManager } from '../../../../packages/ride-lifecycle/ride.manager';
import { pool } from '../../../../packages/database/models';

const router = Router();

// Process payment for completed ride
router.post('/pay', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { rideId, paymentMethodId, paymentMethod, promoCode } = req.body;
        
        // Get ride details
        const ride = await RideLifecycleManager.getRideState(rideId);
        
        if (!ride || ride.riderId !== userId) {
            res.status(404).json({ error: 'Ride not found' });
            return;
        }
        
        if (ride.status !== 'completed') {
            res.status(400).json({ error: 'Ride not completed yet' });
            return;
        }
        
        const result = await PaymentService.processPayment({
            rideId,
            userId,
            amount: ride.finalPrice || 0,
            paymentMethod: paymentMethod || 'stripe',
            stripePaymentMethodId: paymentMethodId,
            promoCode
        });
        
        if (result.success) {
            res.json({
                success: true,
                transactionId: result.transactionId,
                amountPaid: result.amountPaid,
                walletUsed: result.walletUsed,
                promoDiscount: result.promoDiscount,
                receiptUrl: result.receiptUrl
            });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get wallet balance
router.get('/wallet', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        const wallet = await PaymentService.getWalletBalance(userId);
        res.json(wallet);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Add money to wallet
router.post('/wallet/add', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { amount, paymentMethodId } = req.body;
        
        if (!amount || amount <= 0) {
            res.status(400).json({ error: 'Invalid amount' });
            return;
        }
        
        // Process Stripe payment for wallet top-up
        const result = await PaymentService.processPayment({
            rideId: `wallet_${userId}_${Date.now()}`,
            userId,
            amount,
            paymentMethod: 'stripe',
            stripePaymentMethodId: paymentMethodId
        });
        
        if (result.success) {
            await PaymentService.addToWallet(userId, amount, 'wallet_topup');
            res.json({ success: true, newBalance: await PaymentService.getWalletBalance(userId) });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Apply promo code
router.post('/promo/apply', authenticate, async (req: Request, res: Response) => {
    try {
        const userId = req.user!.userId;
        const { promoCode, orderAmount } = req.body;
        
        const result = await PaymentService.applyPromoCode(promoCode, userId, orderAmount);
        
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get ride receipt
router.get('/receipt/:rideId', authenticate, async (req: Request, res: Response) => {
    try {
        const { rideId } = req.params;
        const userId = req.user!.userId;
        
        const receipt = await pool.query(
            `SELECT * FROM receipts WHERE ride_id = $1 AND user_id = $2`,
            [rideId, userId]
        );
        
        if (receipt.rows.length === 0) {
            res.status(404).json({ error: 'Receipt not found' });
            return;
        }
        
        res.json(receipt.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: Create promo code
router.post('/admin/promo/create', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
    try {
        const {
            code,
            discountType,
            discountValue,
            maxDiscount,
            minOrderValue,
            maxUses,
            perUserLimit,
            validFrom,
            validUntil
        } = req.body;
        
        const result = await pool.query(
            `INSERT INTO promo_codes (code, discount_type, discount_value, max_discount, min_order_value, 
                                       max_uses, per_user_limit, valid_from, valid_until, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [code.toUpperCase(), discountType, discountValue, maxDiscount, minOrderValue, 
             maxUses, perUserLimit, validFrom, validUntil, req.user!.userId]
        );
        
        res.status(201).json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;