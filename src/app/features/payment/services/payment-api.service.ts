// src/app/features/payment/services/payment-api.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  JwtRequest,
  JwtResponse,
  PaymentResultResponse
} from '../../../shared/models/payment.models';

@Injectable({ providedIn: 'root' })
export class PaymentApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/payment`;

  /**
   * Requests a signed JWT from the backend for Trust Payments initialisation.
   */
  initiatePayment(request: JwtRequest): Observable<JwtResponse> {
    return this.http.post<JwtResponse>(`${this.baseUrl}/initiate`, request);
  }

  /**
   * Fetches the final transaction result (used on the result page).
   */
  getTransactionResult(transactionId: string): Observable<PaymentResultResponse> {
    return this.http.get<PaymentResultResponse>(`${this.baseUrl}/result/${transactionId}`);
  }
}
