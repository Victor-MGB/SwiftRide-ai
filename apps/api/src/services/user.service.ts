import { UserModel } from '../../../../packages/database/models';

export class UserService {

    static async getAllRiders(params: {
        page?: number;
        limit?: number;
        search?: string;
        isActive?: boolean;
    } = {}) {
        const { page = 1, limit = 20, search = '', isActive } = params;
        const offset = (page - 1) * limit;

        const result = await UserModel.getAllUsers({
            limit,
            offset,
            role: 'rider',
            search: search.trim(),
            isActive,
        });

        return {
            riders: result.users.map(user => ({
                id: user.id,
                fullName: user.full_name,
                email: user.email,
                phone: user.phone,
                isActive: user.is_active,
                createdAt: user.created_at,
                lastLogin: user.last_login,
            })),
            pagination: {
                total: result.total,
                page,
                limit,
                totalPages: Math.ceil(result.total / limit),
            }
        };
    }

    /**
     * Get All Drivers (for Admin)
     */
    static async getAllDrivers(params: {
        page?: number;
        limit?: number;
        search?: string;
        isActive?: boolean;
        isApproved?: boolean;
    } = {}) {
        const { page = 1, limit = 20, search = '', isActive, isApproved } = params;
        const offset = (page - 1) * limit;

        const result = await UserModel.getAllUsers({
            limit,
            offset,
            role: 'driver',
            search: search.trim(),
            isActive,
        });

        return {
            drivers: result.users.map(user => ({
                id: user.id,
                fullName: user.full_name,
                email: user.email,
                phone: user.phone,
                isActive: user.is_active,
                isApproved: user.is_approved,
                vehicleModel: user.vehicle_model,
                vehiclePlate: user.vehicle_plate,
                vehicleColor: user.vehicle_color,
                licensePlate: user.license_plate,
                createdAt: user.created_at,
                lastLogin: user.last_login,
            })),
            pagination: {
                total: result.total,
                page,
                limit,
                totalPages: Math.ceil(result.total / limit),
            }
        };
    }
}