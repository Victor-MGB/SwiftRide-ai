import React, { useState } from 'react';
import axios, { AxiosError } from 'axios';

interface DriverFormData {
  email: string;
  phone: string;
  fullName: string;
  password: string;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleColor: string;
  licensePlate: string;
}

interface SignupResponse {
  accessToken: string;
  refreshToken: string;
}

interface ApiErrorResponse {
  error: string;
}

export const DriverOnboardingForm = () => {
  const [formData, setFormData] = useState<DriverFormData>({
    email: '',
    phone: '',
    fullName: '',
    password: '',
    vehicleModel: '',
    vehiclePlate: '',
    vehicleColor: '',
    licensePlate: '',
  });

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post<SignupResponse>(
        'http://localhost:3001/api/auth/signup/driver',
        formData
      );

      console.log('Signup success:', response.data);

      localStorage.setItem('accessToken', response.data.accessToken);
      localStorage.setItem('refreshToken', response.data.refreshToken);

      window.location.href = '/driver/dashboard';
    } catch (err: unknown) {
      const error = err as AxiosError<ApiErrorResponse>;

      setError(
        error.response?.data?.error || 'Signup failed'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">
        Driver Onboarding
      </h2>

      {error && (
        <div className="bg-red-100 text-red-700 p-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <input
            name="email"
            type="email"
            placeholder="Email"
            value={formData.email}
            onChange={handleChange}
            className="border p-2 rounded"
            required
          />

          <input
            name="phone"
            type="tel"
            placeholder="Phone"
            value={formData.phone}
            onChange={handleChange}
            className="border p-2 rounded"
            required
          />
        </div>

        <input
          name="fullName"
          type="text"
          placeholder="Full Name"
          value={formData.fullName}
          onChange={handleChange}
          className="w-full border p-2 rounded"
          required
        />

        <input
          name="password"
          type="password"
          placeholder="Password"
          value={formData.password}
          onChange={handleChange}
          className="w-full border p-2 rounded"
          required
        />

        <div className="border-t pt-4">
          <h3 className="font-semibold mb-3">
            Vehicle Details
          </h3>

          <input
            name="vehicleModel"
            type="text"
            placeholder="Vehicle Model"
            value={formData.vehicleModel}
            onChange={handleChange}
            className="w-full border p-2 rounded mb-3"
            required
          />

          <input
            name="licensePlate"
            type="text"
            placeholder="License Plate"
            value={formData.licensePlate}
            onChange={handleChange}
            className="w-full border p-2 rounded mb-3"
            required
          />

          <input
            name="vehicleColor"
            type="text"
            placeholder="Vehicle Color"
            value={formData.vehicleColor}
            onChange={handleChange}
            className="w-full border p-2 rounded"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded"
        >
          {loading
            ? 'Creating Account...'
            : 'Register as Driver'}
        </button>
      </form>
    </div>
  );
};