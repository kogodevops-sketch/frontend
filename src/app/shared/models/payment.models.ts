// src/app/shared/models/payment.models.ts

export interface JwtRequest {
  partnerId: string;
  amount: number;
  currency: string;
  orderReference: string;
}

export interface JwtResponse {
  jwt: string;
  transactionId: string;
}

export interface PaymentResultResponse {
  transactionId: string;
  status: 'SUCCESS' | 'FAILED';
  partnerId: string;
  amount: number;
  currency: string;
  orderReference: string;
  errorCode: string;
  errorMessage: string;
  maskedPan: string;
  paymentType: string;
  authCode: string;
}

export interface ApiError {
  status: number;
  error: string;
  message: string;
  timestamp: string;
}

export type PaymentStatus = 'IDLE' | 'LOADING_JWT' | 'READY' | 'PROCESSING' | 'ERROR';
