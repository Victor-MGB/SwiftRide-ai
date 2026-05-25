import dotenv from 'dotenv'
dotenv.config()

import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword)
}

// generate otp
export function generateOTP(length: number = 6): string{
    return Math.floor(Math.random() * Math.pow(10,length)).toString().padStart(length, '0');
}
