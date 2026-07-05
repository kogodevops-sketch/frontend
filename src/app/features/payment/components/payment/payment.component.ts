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
import { ActivatedRoute, ParamMap } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { PaymentApiService } from '../../services/payment-api.service';
import { TrustPaymentsLoaderService } from '../../services/trustpayments-loader.service';
import { PaymentStatus, PaymentResultResponse } from '../../../../shared/models/payment.models';
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
  styles?: Record<string, string>;
}

// Dark-theme styling for the Trust Payments card-field iframes. Without this the
// input text renders dark and is invisible on our dark input backgrounds.
const TP_DARK_STYLES: Record<string, string> = {
  'font-size-input': '15px',
  'font-family-input': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'color-input': '#f1f5f9',
  'color-input-placeholder': '#64748b',
  'background-color-input': 'transparent',
  'space-inset-input': '13px 14px',
  'color-input-error': '#f87171',
  'color-label': '#94a3b8',
};

interface SecureTradingInstance {
  Components: (options?: {
    callbacks?: {
      onPaymentFormRendered?: () => void;
      onPaymentFormValidityChange?: (data: { isFormValid: boolean }) => void;
    };
  }) => void;
}

/**
 * Payment parameters that arrive on the payment link URL, e.g.
 *   /pay?partner_id=AIMS_PROD_001&amount=249.99&currency=GBP&reference_id=INV-2024-00842
 */
interface PaymentParams {
  partnerId: string;       // partner_id
  amount: number;          // amount
  currency: string;        // currency
  orderReference: string;  // reference_id
}

// Persist the link params across the callback round-trip (the backend redirect
// only carries transactionId, so we stash the originals to allow a failure retry).
const PARAMS_STORAGE_KEY = 'kogopay.paymentParams';

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
  private readonly route = inject(ActivatedRoute);

  // Reactive state
  readonly status = signal<PaymentStatus>('IDLE');
  readonly errorMessage = signal<string | null>(null);
  readonly errorTitle = signal<string>('Payment form unavailable');
  readonly isLinkError = signal<boolean>(false);
  readonly isFormValid = signal<boolean>(false);
  readonly isFormRendered = signal<boolean>(false);

  // Values taken from the payment link, shown in the UI (e.g. the Pay button)
  readonly amount = signal<number | null>(null);
  readonly currency = signal<string>('');
  readonly referenceId = signal<string>('');

  // Payment outcome shown inline after returning from Trust Payments (via /callback redirect)
  readonly outcome = signal<PaymentResultResponse | null>(null);

  // Computed flags for template clarity
  readonly isLoading = computed(() =>
    this.status() === 'LOADING_JWT' || this.status() === 'PROCESSING'
  );
  readonly isReady = computed(() => this.status() === 'READY');
  readonly hasError = computed(() => this.status() === 'ERROR');

  // Outcome flags
  readonly paidSuccess = computed(() => this.outcome()?.status === 'SUCCESS');
  readonly paidFailure = computed(() => this.outcome()?.status === 'FAILED');
  // Show the card form unless the payment already succeeded, or the link was invalid.
  readonly showForm = computed(() => !this.paidSuccess() && !this.isLinkError());

  // Stored transactionId returned by /initiate, used to build the callback URL
  private transactionId: string | null = null;

  async ngOnInit(): Promise<void> {
    const qp = this.route.snapshot.queryParamMap;

    // Case 1: redirected back from /callback — the URL carries the transactionId.
    const returnedTxnId = qp.get('transactionId');
    if (returnedTxnId) {
      await this.loadOutcome(returnedTxnId);
      return;
    }

    // Case 2: fresh payment link — read partner_id / amount / currency / reference_id.
    const params = this.readParamsFromUrl(qp);
    if (!params) {
      this.showLinkError();
      return;
    }

    this.applyParams(params);
    this.saveParams(params);
    await this.initialisePaymentForm(params);
  }

  ngOnDestroy(): void {
    // Reset loader so st.js reloads fresh on next visit (per Trust Payments docs)
    this.loaderService.reset();
  }

  // ── Param parsing / persistence ────────────────────────────────────────────

  /** Reads and validates the four payment-link params. Returns null if invalid. */
  private readParamsFromUrl(qp: ParamMap): PaymentParams | null {
    const partnerId      = qp.get('partner_id')?.trim();
    const amountRaw      = qp.get('amount')?.trim();
    const currency       = qp.get('currency')?.trim().toUpperCase();
    const orderReference = qp.get('reference_id')?.trim();

    if (!partnerId || !amountRaw || !currency || !orderReference) {
      return null;
    }

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 0.01) {
      return null;
    }
    if (currency.length !== 3) {
      return null;
    }

    return { partnerId, amount, currency, orderReference };
  }

  private applyParams(params: PaymentParams): void {
    this.amount.set(params.amount);
    this.currency.set(params.currency);
    this.referenceId.set(params.orderReference);
  }

  private saveParams(params: PaymentParams): void {
    try {
      sessionStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
    } catch { /* sessionStorage unavailable — retry-after-failure just won't prefill */ }
  }

  private readSavedParams(): PaymentParams | null {
    try {
      const raw = sessionStorage.getItem(PARAMS_STORAGE_KEY);
      return raw ? JSON.parse(raw) as PaymentParams : null;
    } catch {
      return null;
    }
  }

  private showLinkError(): void {
    this.status.set('ERROR');
    this.isLinkError.set(true);
    this.errorTitle.set('Invalid payment link');
    this.errorMessage.set(
      'This payment link is missing or has invalid details. It must include ' +
      'partner_id, amount, currency and reference_id.'
    );
  }

  // ── Outcome (return from Trust Payments) ────────────────────────────────────

  /**
   * Called when the browser returns from Trust Payments (via the backend /callback
   * 302 redirect to /pay?transactionId=...). Fetches the stored result and shows a
   * success/failure banner. On failure we re-initialise the form (using the saved
   * link params) so the user can retry inline.
   */
  private async loadOutcome(transactionId: string): Promise<void> {
    this.status.set('LOADING_JWT');
    try {
      const result = await this.paymentApiService
        .getTransactionResult(transactionId)
        .toPromise() as PaymentResultResponse;

      this.outcome.set(result);
      this.status.set('IDLE');

      // The result carries the original amount/currency so the UI can show it even
      // if sessionStorage was lost (e.g. new tab). Prefer the result; fall back to storage.
      const params: PaymentParams | null =
        (result.amount != null && result.currency)
          ? {
              partnerId:      result.partnerId,
              amount:         result.amount,
              currency:       result.currency,
              orderReference: result.orderReference
            }
          : this.readSavedParams();

      if (params) {
        this.applyParams(params);
      }

      if (result.status === 'SUCCESS') {
        // Payment done — no need to keep the params around.
        this.clearSavedParams();
        return;
      }

      // Failed → offer an inline retry using the original link params.
      if (params) {
        await this.initialisePaymentForm(params);
      }
    } catch (error) {
      this.handleInitError(error);
    }
  }

  private clearSavedParams(): void {
    try { sessionStorage.removeItem(PARAMS_STORAGE_KEY); } catch { /* ignore */ }
  }

  // ── st.js initialisation ────────────────────────────────────────────────────

  private async initialisePaymentForm(params: PaymentParams): Promise<void> {
    this.status.set('LOADING_JWT');
    this.errorMessage.set(null);

    try {
      // Load st.js from CDN
      await this.loaderService.load();

      // Request signed JWT from backend using the payment-link params
      const { jwt, transactionId } = await this.paymentApiService
        .initiatePayment({
          partnerId:      params.partnerId,
          amount:         params.amount,
          currency:       params.currency,
          orderReference: params.orderReference
        })
        .toPromise() as { jwt: string; transactionId: string };

      this.transactionId = transactionId;

      // Initialise st.js with the JWT
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
      livestatus: environment.liveStatus,
      animatedCard: false,
      panIcon: true,
      submitOnSuccess: true,
      submitOnError: true,
      submitOnCancel: false,
      disableNotification: false,
      styles: TP_DARK_STYLES,
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
    const saved = this.readSavedParams();
    if (!saved) {
      this.showLinkError();
      return;
    }
    this.isFormRendered.set(false);
    this.isFormValid.set(false);
    this.applyParams(saved);
    this.initialisePaymentForm(saved);
  }
}
