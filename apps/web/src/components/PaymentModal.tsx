import React, { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

interface PaymentModalProps {
    rideId: string;
    amount: number;
    onSuccess: () => void;
    onClose: () => void;
}

const PaymentForm: React.FC<{ rideId: string; amount: number; onSuccess: () => void; onClose: () => void }> = ({ 
    rideId, 
    amount, 
    onSuccess, 
    onClose 
}) => {
    const stripe = useStripe();
    const elements = useElements();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [useWallet, setUseWallet] = useState(false);
    const [walletBalance, setWalletBalance] = useState(0);
    const [promoCode, setPromoCode] = useState('');
    const [promoDiscount, setPromoDiscount] = useState(0);
    const [finalAmount, setFinalAmount] = useState(amount);
    
    useEffect(() => {
        fetchWalletBalance();
    }, []);
    
    const fetchWalletBalance = async () => {
        const response = await fetch('http://localhost:3001/api/payment/wallet', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        });
        const data = await response.json();
        setWalletBalance(data.balance);
    };
    
    const applyPromoCode = async () => {
        const response = await fetch('http://localhost:3001/api/payment/promo/apply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
            },
            body: JSON.stringify({ promoCode, orderAmount: amount })
        });
        
        const result = await response.json();
        if (result.valid) {
            setPromoDiscount(result.discount);
            setFinalAmount(amount - result.discount);
        } else {
            setError(result.message);
        }
    };
    
    const handlePayment = async () => {
        if (!stripe || !elements) return;
        
        setLoading(true);
        setError('');
        
        const cardElement = elements.getElement(CardElement);
        
        try {
            // Create payment method
            const { error: stripeError, paymentMethod } = await stripe.createPaymentMethod({
                type: 'card',
                card: cardElement!,
            });
            
            if (stripeError) {
                setError(stripeError.message || 'Payment failed');
                setLoading(false);
                return;
            }
            
            // Process payment
            const response = await fetch('http://localhost:3001/api/payment/pay', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                },
                body: JSON.stringify({
                    rideId,
                    paymentMethodId: paymentMethod.id,
                    paymentMethod: 'stripe',
                    promoCode: promoCode || undefined
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                onSuccess();
            } else {
                setError(result.error || 'Payment failed');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
                <h2 className="text-2xl font-bold mb-4">Payment</h2>
                
                <div className="space-y-4">
                    {/* Amount Display */}
                    <div className="bg-gray-100 p-4 rounded-lg">
                        <div className="flex justify-between mb-2">
                            <span>Ride fare:</span>
                            <span>${amount.toFixed(2)}</span>
                        </div>
                        {promoDiscount > 0 && (
                            <div className="flex justify-between text-green-600">
                                <span>Promo discount:</span>
                                <span>-${promoDiscount.toFixed(2)}</span>
                            </div>
                        )}
                        {useWallet && walletBalance > 0 && (
                            <div className="flex justify-between text-blue-600">
                                <span>Wallet credit:</span>
                                <span>-${Math.min(walletBalance, finalAmount).toFixed(2)}</span>
                            </div>
                        )}
                        <div className="border-t pt-2 mt-2">
                            <div className="flex justify-between font-bold">
                                <span>Total:</span>
                                <span>${finalAmount.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                    
                    {/* Promo Code */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Promo code"
                            value={promoCode}
                            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                            className="flex-1 border p-2 rounded"
                        />
                        <button
                            onClick={applyPromoCode}
                            className="px-4 bg-gray-200 rounded hover:bg-gray-300"
                        >
                            Apply
                        </button>
                    </div>
                    
                    {/* Wallet Toggle */}
                    {walletBalance > 0 && (
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={useWallet}
                                onChange={(e) => setUseWallet(e.target.checked)}
                            />
                            <span>Use wallet balance (${walletBalance.toFixed(2)})</span>
                        </label>
                    )}
                    
                    {/* Card Element */}
                    <div className="border rounded p-3">
                        <CardElement options={{
                            style: {
                                base: {
                                    fontSize: '16px',
                                    color: '#424770',
                                    '::placeholder': { color: '#aab7c4' }
                                }
                            }
                        }} />
                    </div>
                    
                    {error && (
                        <div className="bg-red-100 text-red-700 p-3 rounded">
                            {error}
                        </div>
                    )}
                    
                    <div className="flex gap-2">
                        <button
                            onClick={handlePayment}
                            disabled={loading || !stripe}
                            className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
                        >
                            {loading ? 'Processing...' : `Pay $${finalAmount.toFixed(2)}`}
                        </button>
                        <button
                            onClick={onClose}
                            className="flex-1 bg-gray-200 py-2 rounded hover:bg-gray-300"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const PaymentModal: React.FC<PaymentModalProps> = (props) => (
    <Elements stripe={stripePromise}>
        <PaymentForm {...props} />
    </Elements>
);