// src/app/features/payment/components/payment/payment.component.ts
import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { PaymentApiService } from '../../services/payment-api.service';
import { TrustPaymentsLoaderService } from '../../services/trustpayments-loader.service';
import { PaymentStatus } from '../../../../shared/models/payment.models';
import { environment } from '../../../../../environments/environment';

// Extend Window to include SecureTrading from st.js
declare global {
  interface Window {
    SecureTrading: (config: SecureTradingConfig) => SecureTradingInstance;
  }
}

interface SecureTradingConfig {
  jwt: string;
  livestatus: number;
  submitFields?: string[];
  submitOnSuccess?: boolean;
  submitOnError?: boolean;
  submitOnCancel?: boolean;
  disableNotification?: boolean;
  animatedCard?: boolean;
  panIcon?: boolean;
}

interface SecureTradingInstance {
  Components: (options?: {
    callbacks?: {
      onPaymentFormRendered?: () => void;
      onPaymentFormValidityChange?: (data: { isFormValid: boolean }) => void;
    };
  }) => void;
}

// Hardcoded values as per requirements
const PAYMENT_CONFIG = {
  PARTNER_ID: 'PARTNER_001',
  AMOUNT: 10.50,
  CURRENCY: 'GBP'
} as const;

@Component({
  selector: 'app-payment',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './payment.component.html',
  styleUrls: ['./payment.component.scss']
})
export class PaymentComponent implements OnInit, OnDestroy {

  private readonly paymentApiService = inject(PaymentApiService);
  private readonly loaderService = inject(TrustPaymentsLoaderService);
  private readonly router = inject(Router);

  // Reactive state
  readonly status = signal<PaymentStatus>('IDLE');
  readonly errorMessage = signal<string | null>(null);
  readonly isFormValid = signal<boolean>(false);
  readonly isFormRendered = signal<boolean>(false);

  // Computed flags for template clarity
  readonly isLoading = computed(() =>
    this.status() === 'LOADING_JWT' || this.status() === 'PROCESSING'
  );
  readonly isReady = computed(() => this.status() === 'READY');
  readonly hasError = computed(() => this.status() === 'ERROR');

  // Stored transactionId for routing to result page
  private transactionId: string | null = null;

  readonly paymentConfig = PAYMENT_CONFIG;

  async ngOnInit(): Promise<void> {
    await this.initialisePaymentForm();
  }

  ngOnDestroy(): void {
    // Reset loader so st.js reloads fresh on next visit (per Trust Payments docs)
    this.loaderService.reset();
  }

  private async initialisePaymentForm(): Promise<void> {
    this.status.set('LOADING_JWT');
    this.errorMessage.set(null);

    try {
      // Step 1: Generate a unique order reference
      const orderReference = this.generateOrderReference();

      // Step 2: Load st.js from CDN
      await this.loaderService.load();

      // Step 3: Request signed JWT from backend
      const { jwt, transactionId } = await this.paymentApiService
        .initiatePayment({
          partnerId: PAYMENT_CONFIG.PARTNER_ID,
          amount:    PAYMENT_CONFIG.AMOUNT,
          currency:  PAYMENT_CONFIG.CURRENCY,
          orderReference
        })
        .toPromise() as { jwt: string; transactionId: string };

      this.transactionId = transactionId;

      // Step 4: Initialise st.js with the JWT
      this.initialiseSt(jwt);

    } catch (error) {
      this.handleInitError(error);
    }
  }

  private initialiseSt(jwt: string): void {
    if (typeof window.SecureTrading === 'undefined') {
      this.status.set('ERROR');
      this.errorMessage.set('Payment library failed to load. Please refresh and try again.');
      return;
    }

    const callbackUrl = this.buildCallbackUrl();

    // Dynamically set the form action to include transactionId
    const form = document.getElementById('st-form');
    if (form) {
      form.setAttribute('action', callbackUrl);
    }

    const st = window.SecureTrading({
      jwt,
      livestatus: 0,
      animatedCard: false,
      panIcon: true,
      submitOnSuccess: true,
      submitOnError: true,
      submitOnCancel: false,
      disableNotification: false,
    });

    st.Components({
      callbacks: {
        onPaymentFormRendered: () => {
          this.isFormRendered.set(true);
          this.status.set('READY');
        },
        onPaymentFormValidityChange: (data: { isFormValid: boolean }) => {
          this.isFormValid.set(data.isFormValid);
        }
      }
    });
  }

  /**
   * Builds the callback URL including the transactionId as a query param.
   * Trust Payments will POST the response JWT to this URL.
   * Spring Boot reads transactionId from the query param to look up the DB record.
   */
  private buildCallbackUrl(): string {
    const base = `${environment.apiBaseUrl}/payment/callback`;
    return `${base}?transactionid=${this.transactionId}`;
  }

  private handleInitError(error: unknown): void {
    this.status.set('ERROR');

    if (error instanceof HttpErrorResponse) {
      this.errorMessage.set(
        error.error?.userMessage ?? error.error?.message ?? 'Failed to initialise payment.'
      );
    } else if (error instanceof Error) {
      this.errorMessage.set(error.message);
    } else {
      this.errorMessage.set('An unexpected error occurred. Please refresh and try again.');
    }

    console.error('[Payment] Initialisation error:', error);
  }

  retryInitialise(): void {
    this.isFormRendered.set(false);
    this.isFormValid.set(false);
    this.initialisePaymentForm();
  }

  private generateOrderReference(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }
}
