import Stripe from 'stripe';
import { pool } from '../database/models';
import { redis } from '../redis/client';
import { v4 as uuidv4 } from 'uuid';

// Initialize Stripe with test key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: "2026-04-22.dahlia",
});

export interface PaymentRequest {
    rideId: string;
    userId: string;
    amount: number;
    paymentMethod: 'stripe' | 'wallet' | 'cash';
    stripePaymentMethodId?: string;
    promoCode?: string;
    splitWith?: Array<{ userId: string; amount: number }>;
}

export interface PaymentResult {
    success: boolean;
    transactionId: string;
    amountPaid: number;
    paymentMethod: string;
    walletUsed?: number;
    promoDiscount?: number;
    receiptUrl?: string;
    error?: string;
}

export class PaymentService {
    
    // Process payment for a ride
    static async processPayment(request: PaymentRequest): Promise<PaymentResult> {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            let finalAmount = request.amount;
            let promoDiscount = 0;
            let walletUsed = 0;
            
            // 1. Apply promo code if provided
            if (request.promoCode) {
                const promoResult = await this.applyPromoCode(
                    request.promoCode,
                    request.userId,
                    finalAmount
                );
                
                if (promoResult.valid) {
                    promoDiscount = promoResult.discount;
                    finalAmount -= promoDiscount;
                }
            }
            
            // 2. Check wallet balance and apply if available
            const wallet = await this.getWalletBalance(request.userId);
            if (wallet && wallet.balance > 0 && finalAmount > 0) {
                walletUsed = Math.min(wallet.balance, finalAmount);
                finalAmount -= walletUsed;
                
                // Deduct from wallet
                await this.deductFromWallet(request.userId, walletUsed, request.rideId);
            }
            
            // 3. Process remaining payment
            let paymentResult: PaymentResult | null = null;
            
            if (finalAmount > 0) {
                if (request.paymentMethod === 'stripe' && request.stripePaymentMethodId) {
                    paymentResult = await this.processStripePayment(
                        request.userId,
                        finalAmount,
                        request.stripePaymentMethodId,
                        request.rideId
                    );
                } else if (request.paymentMethod === 'cash') {
                    paymentResult = await this.processCashPayment(request.rideId, finalAmount);
                } else {
                    throw new Error('Insufficient payment method or amount');
                }
            }
            
            // 4. Create ride payment record
            const paymentId = await this.createPaymentRecord({
                rideId: request.rideId,
                userId: request.userId,
                amount: request.amount,
                finalAmount: finalAmount,
                walletUsed,
                promoDiscount,
                paymentMethod: request.paymentMethod,
                stripePaymentId: paymentResult?.transactionId
            });
            
            // 5. Generate receipt
            const receipt = await this.generateReceipt(request.rideId, request.userId);
            
            // 6. Update ride status to completed
            await this.completeRideTransaction(request.rideId);
            
            await client.query('COMMIT');
            
            return {
                success: true,
                transactionId: paymentId,
                amountPaid: finalAmount,
                paymentMethod: request.paymentMethod,
                walletUsed,
                promoDiscount,
                receiptUrl: receipt.pdfUrl
            };
            
        } catch (error: any) {
            await client.query('ROLLBACK');
            console.error('Payment processing error:', error);
            
            return {
                success: false,
                transactionId: '',
                amountPaid: 0,
                paymentMethod: request.paymentMethod,
                error: error.message
            };
        } finally {
            client.release();
        }
    }
    
    // Process Stripe payment
    private static async processStripePayment(
        userId: string,
        amount: number,
        paymentMethodId: string,
        rideId: string
    ): Promise<PaymentResult> {
        try {
            // Get or create Stripe customer
            let customerId = await this.getStripeCustomerId(userId);
            
            if (!customerId) {
                const customer = await stripe.customers.create({
                    metadata: { userId }
                });
                customerId = customer.id;
                await this.saveStripeCustomerId(userId, customerId);
            }
            
            // Create payment intent
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(amount * 100), // Convert to cents
                currency: 'usd',
                customer: customerId,
                payment_method: paymentMethodId,
                confirm: true,
                off_session: false,
                metadata: {
                    rideId,
                    userId
                }
            });
            
            if (paymentIntent.status === 'succeeded') {
                return {
                    success: true,
                    transactionId: paymentIntent.id,
                    amountPaid: amount,
                    paymentMethod: 'stripe'
                };
            } else {
                throw new Error(`Payment failed: ${paymentIntent.status}`);
            }
        } catch (error: any) {
            console.error('Stripe error:', error);
            throw new Error(`Stripe payment failed: ${error.message}`);
        }
    }
    
    // Process cash payment (mock)
    private static async processCashPayment(rideId: string, amount: number): Promise<PaymentResult> {
        // Just record the cash payment
        return {
            success: true,
            transactionId: `cash_${rideId}_${Date.now()}`,
            amountPaid: amount,
            paymentMethod: 'cash'
        };
    }
    
    // Apply promo code
    static async applyPromoCode(
        code: string,
        userId: string,
        orderAmount: number
    ): Promise<{ valid: boolean; discount: number; message?: string }> {
        const result = await pool.query(
            `SELECT * FROM promo_codes 
             WHERE code = $1 
             AND is_active = true 
             AND valid_from <= NOW() 
             AND valid_until >= NOW()`,
            [code.toUpperCase()]
        );
        
        if (result.rows.length === 0) {
            return { valid: false, discount: 0, message: 'Invalid or expired promo code' };
        }
        
        const promo = result.rows[0];
        
        // Check max uses
        if (promo.max_uses && promo.used_count >= promo.max_uses) {
            return { valid: false, discount: 0, message: 'Promo code has reached maximum uses' };
        }
        
        // Check user usage limit
        const userUsage = await pool.query(
            `SELECT COUNT(*) FROM ride_promo_applications rpa
             JOIN rides r ON r.id = rpa.ride_id
             WHERE rpa.promo_code_id = $1 AND r.rider_id = $2`,
            [promo.id, userId]
        );
        
        if (parseInt(userUsage.rows[0].count) >= promo.per_user_limit) {
            return { valid: false, discount: 0, message: 'You have already used this promo code' };
        }
        
        // Check minimum order value
        if (promo.min_order_value && orderAmount < promo.min_order_value) {
            return { valid: false, discount: 0, message: `Minimum order value of $${promo.min_order_value} required` };
        }
        
        // Calculate discount
        let discount = 0;
        if (promo.discount_type === 'percentage') {
            discount = (orderAmount * promo.discount_value) / 100;
            if (promo.max_discount) {
                discount = Math.min(discount, promo.max_discount);
            }
        } else {
            discount = promo.discount_value;
        }
        
        return { valid: true, discount: Math.min(discount, orderAmount) };
    }
    
    // Wallet management
    static async getWalletBalance(userId: string): Promise<{ balance: number; totalEarned: number; totalSpent: number } | null> {
        const result = await pool.query(
            `SELECT balance, total_earned, total_spent FROM wallets WHERE user_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0) {
            // Create wallet for user
            await pool.query(
                `INSERT INTO wallets (user_id, balance) VALUES ($1, 0)`,
                [userId]
            );
            return { balance: 0, totalEarned: 0, totalSpent: 0 };
        }
        
        return result.rows[0];
    }
    
    static async addToWallet(userId: string, amount: number, referenceId?: string): Promise<boolean> {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Get wallet
            let wallet = await this.getWalletBalance(userId);
            if (!wallet) {
                await pool.query(`INSERT INTO wallets (user_id, balance) VALUES ($1, 0)`, [userId]);
                wallet = { balance: 0, totalEarned: 0, totalSpent: 0 };
            }
            
            // Get wallet ID
            const walletResult = await pool.query(`SELECT id FROM wallets WHERE user_id = $1`, [userId]);
            const walletId = walletResult.rows[0].id;
            
            // Update balance
            await pool.query(
                `UPDATE wallets SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2`,
                [amount, userId]
            );
            
            // Create transaction record
            await pool.query(
                `INSERT INTO wallet_transactions (wallet_id, amount, type, reference_id, description)
                 VALUES ($1, $2, 'credit', $3, $4)`,
                [walletId, amount, referenceId, 'Ride earnings']
            );
            
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Wallet add error:', error);
            return false;
        } finally {
            client.release();
        }
    }
    
    static async deductFromWallet(userId: string, amount: number, referenceId?: string): Promise<boolean> {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const walletResult = await pool.query(`SELECT id FROM wallets WHERE user_id = $1`, [userId]);
            if (walletResult.rows.length === 0) {
                throw new Error('Wallet not found');
            }
            
            const walletId = walletResult.rows[0].id;
            
            // Update balance
            await pool.query(
                `UPDATE wallets SET balance = balance - $1, total_spent = total_spent + $1, updated_at = NOW() WHERE user_id = $2`,
                [amount, userId]
            );
            
            // Create transaction record
            await pool.query(
                `INSERT INTO wallet_transactions (wallet_id, amount, type, reference_id, description)
                 VALUES ($1, $2, 'debit', $3, $4)`,
                [walletId, amount, referenceId, 'Ride payment']
            );
            
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Wallet deduct error:', error);
            return false;
        } finally {
            client.release();
        }
    }
    
    // Receipt generation
    static async generateReceipt(rideId: string, userId: string): Promise<{ pdfUrl: string; receiptNumber: string }> {
        const receiptNumber = `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
        
        // Get ride and payment details
        const rideResult = await pool.query(
            `SELECT r.*, 
                    u.full_name as rider_name,
                    u.email as rider_email,
                    d.full_name as driver_name,
                    p.amount as payment_amount,
                    p.payment_method,
                    pr.discount_amount as promo_discount
             FROM rides r
             JOIN users u ON r.rider_id = u.id
             JOIN users d ON r.driver_id = d.id
             LEFT JOIN payments p ON r.id = p.ride_id
             LEFT JOIN ride_promo_applications rpa ON r.id = rpa.ride_id
             LEFT JOIN promo_codes pr ON rpa.promo_code_id = pr.id
             WHERE r.id = $1`,
            [rideId]
        );
        
        const receipt = await pool.query(
            `INSERT INTO receipts (ride_id, user_id, receipt_number)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [rideId, userId, receiptNumber]
        );
        
        // Generate PDF (mock - in production use PDFKit or similar)
        const pdfUrl = `${process.env.BASE_URL}/receipts/${receiptNumber}.pdf`;
        
        // Update receipt with PDF URL
        await pool.query(
            `UPDATE receipts SET pdf_url = $1 WHERE id = $2`,
            [pdfUrl, receipt.rows[0].id]
        );
        
        // Send email with receipt
        await this.emailReceipt(
            rideResult.rows[0].rider_email,
            receiptNumber,
            rideResult.rows[0]
        );
        
        return { pdfUrl, receiptNumber };
    }
    
    // Email receipt
    private static async emailReceipt(email: string, receiptNumber: string, rideData: any): Promise<void> {
        // Mock email - integrate with SendGrid, AWS SES, etc.
        console.log(`Sending receipt ${receiptNumber} to ${email}`);
    }
    
    // Helper methods
    private static async getStripeCustomerId(userId: string): Promise<string | null> {
        const result = await pool.query(
            `SELECT stripe_customer_id FROM users WHERE id = $1`,
            [userId]
        );
        return result.rows[0]?.stripe_customer_id || null;
    }
    
    private static async saveStripeCustomerId(userId: string, customerId: string): Promise<void> {
        await pool.query(
            `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
            [customerId, userId]
        );
    }
    
    private static async createPaymentRecord(data: any): Promise<string> {
        const paymentId = uuidv4();
        await pool.query(
            `INSERT INTO payments (id, ride_id, user_id, amount, payment_method, stripe_payment_intent_id, status, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', NOW())`,
            [paymentId, data.rideId, data.userId, data.finalAmount, data.paymentMethod, data.stripePaymentId]
        );
        return paymentId;
    }
    
    private static async completeRideTransaction(rideId: string): Promise<void> {
        await pool.query(
            `UPDATE rides SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [rideId]
        );
        
        // Add earnings to driver's wallet
        const rideResult = await pool.query(
            `SELECT driver_id, total_price FROM rides WHERE id = $1`,
            [rideId]
        );
        
        if (rideResult.rows[0]?.driver_id) {
            const driverEarnings = rideResult.rows[0].total_price * 0.8; // 80% to driver, 20% platform fee
            await this.addToWallet(rideResult.rows[0].driver_id, driverEarnings, rideId);
        }
    }
}