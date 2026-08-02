// src/app/shared/models/payment.models.ts

export interface JwtRequest {
  partnerId: string;
  amount: number;
  currency: string;
  orderReference: string;
  signature?: string;   // AIMS `sig` from the payment link (anti-tampering)
  // Billing details — collected on the KogoPay page for every card, required by Trust
  // Payments' MCC 4829 (Money Transfer) rules. Sent unconditionally (not just for Visa) to
  // avoid depending on client-side card-brand detection.
  billingFirstName: string;
  billingLastName: string;
  billingCountry: string;  // ISO 3166-1 alpha-2, e.g. "GB", "IN" — also used as billingcounty
  // MCC 4829 (Money Transfer) — the customer's account identifier with the merchant.
  // customeraccountnumbertype is always "ACCOUNT" and is set server-side (not user input).
  customerAccountNumber: string;
  // MCC 4829 billing address + date of birth (YYYY-MM-DD).
  billingDob: string;
  billingPostcode: string;
  billingPremise: string;
  billingStreet: string;
  billingTown: string;
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
