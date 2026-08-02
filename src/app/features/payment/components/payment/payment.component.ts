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

// Light-theme styling for the Trust Payments card-field iframes. Inputs are white,
// so the typed text must be DARK (otherwise the card digits are invisible).
const TP_DARK_STYLES: Record<string, string> = {
  'font-size-input': '15px',
  'font-family-input': "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  'color-input': '#3a1f24',
  'color-input-placeholder': '#b6a6a8',
  'background-color-input': 'transparent',
  'space-inset-input': '14px 14px',
  'color-input-error': '#c0392b',
  // Let OUR container provide the single, consistent outline — remove st.js's own
  // input border/outline so an empty required field doesn't flash an alarming red box.
  'border-size-input': '0',
  'border-size-input-error': '0',
  'outline-input': 'none',
  'box-shadow-input': 'none',
  'box-shadow-input-error': 'none',
  // Hide st.js's own field labels — we render our own labels outside the iframes,
  // so this stops "Card number / Expiration date / Security code" showing twice.
  'display-label': 'none',
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
  signature?: string;      // sig — AIMS HMAC signature (anti-tampering)
}

// Persist the link params across the callback round-trip (the backend redirect
// only carries transactionId, so we stash the originals to allow a failure retry).
const PARAMS_STORAGE_KEY = 'kogopay.paymentParams';

// Persist the customer's billing details so a retry can pre-fill them instead of
// asking again from scratch.
const BILLING_STORAGE_KEY = 'kogopay.billingDetails';

interface BillingDetails {
  firstName: string;
  lastName: string;
  country: string;
  accountNumber: string;
  dob: string;
  postcode: string;
  premise: string;
  street: string;
  town: string;
}

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

  // Billing details — collected on this page for EVERY card (not just Visa), required by
  // Trust Payments' MCC 4829 (Money Transfer) rules. Shown before the card form; the card
  // form only initialises once these are submitted.
  readonly billingDetailsSubmitted = signal<boolean>(false);
  readonly billingFirstName = signal<string>('');
  readonly billingLastName = signal<string>('');
  readonly billingCountry = signal<string>('');
  readonly billingAccountNumber = signal<string>('');
  readonly billingDob = signal<string>('');
  readonly billingPostcode = signal<string>('');
  readonly billingPremise = signal<string>('');
  readonly billingStreet = signal<string>('');
  readonly billingTown = signal<string>('');
  readonly billingError = signal<string | null>(null);

  // Values taken from the payment link, shown in the UI (e.g. the Pay button)
  readonly amount = signal<number | null>(null);
  readonly currency = signal<string>('');
  readonly referenceId = signal<string>('');
  readonly partnerId = signal<string>('');

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

  // Bounds for the date-of-birth picker: no future dates, and a sane floor so a stray
  // year like 0202 (an easy typo in a date input) is caught before it reaches the gateway.
  readonly maxDob = new Date().toISOString().slice(0, 10);
  readonly minDob = '1900-01-01';

  // Stored transactionId returned by /initiate, used to build the callback URL
  private transactionId: string | null = null;

  // Link params held while we wait for the billing-details step to be submitted.
  private linkParams: PaymentParams | null = null;

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

    // Don't initialise st.js yet — collect billing details first (required in every
    // /initiate call). submitBillingDetails() drives the next step.
    this.linkParams = params;
    this.prefillBillingDetails();
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
    const signature      = qp.get('sig')?.trim() || undefined;   // AIMS anti-tampering signature

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

    return { partnerId, amount, currency, orderReference, signature };
  }

  private applyParams(params: PaymentParams): void {
    this.amount.set(params.amount);
    this.currency.set(params.currency);
    this.referenceId.set(params.orderReference);
    this.partnerId.set(params.partnerId);
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

  // ── Billing details step ────────────────────────────────────────────────────

  private saveBillingDetails(details: BillingDetails): void {
    try { sessionStorage.setItem(BILLING_STORAGE_KEY, JSON.stringify(details)); } catch { /* ignore */ }
  }

  private readSavedBillingDetails(): BillingDetails | null {
    try {
      const raw = sessionStorage.getItem(BILLING_STORAGE_KEY);
      return raw ? JSON.parse(raw) as BillingDetails : null;
    } catch {
      return null;
    }
  }

  private prefillBillingDetails(): void {
    const saved = this.readSavedBillingDetails();
    if (saved) {
      this.billingFirstName.set(saved.firstName);
      this.billingLastName.set(saved.lastName);
      this.billingCountry.set(saved.country);
      this.billingAccountNumber.set(saved.accountNumber);
      this.billingDob.set(saved.dob);
      this.billingPostcode.set(saved.postcode);
      this.billingPremise.set(saved.premise);
      this.billingStreet.set(saved.street);
      this.billingTown.set(saved.town);
    }
  }

  /** Validates the mandatory billing fields, then initialises the payment form. */
  async submitBillingDetails(): Promise<void> {
    const firstName = this.billingFirstName().trim();
    const lastName = this.billingLastName().trim();
    const country = this.billingCountry().trim().toUpperCase();
    const accountNumber = this.billingAccountNumber().trim();
    const dob = this.billingDob().trim();
    const postcode = this.billingPostcode().trim();
    const premise = this.billingPremise().trim();
    const street = this.billingStreet().trim();
    const town = this.billingTown().trim();

    if (!firstName || !lastName) {
      this.billingError.set('Please enter your first and last name.');
      return;
    }
    if (!/^[A-Z]{2}$/.test(country)) {
      this.billingError.set('Please enter a valid 2-letter country code (e.g. GB, IN, US).');
      return;
    }
    if (!accountNumber) {
      this.billingError.set('Please enter your account number.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      this.billingError.set('Please enter your date of birth.');
      return;
    }
    if (dob > this.maxDob) {
      this.billingError.set('Date of birth cannot be in the future.');
      return;
    }
    if (dob < this.minDob) {
      this.billingError.set('Please enter a valid date of birth.');
      return;
    }
    if (!premise || !street || !town || !postcode) {
      this.billingError.set('Please complete your full billing address.');
      return;
    }
    if (!this.linkParams) {
      this.billingError.set('Something went wrong. Please refresh and try again.');
      return;
    }

    this.billingError.set(null);
    this.billingCountry.set(country);
    this.saveBillingDetails({ firstName, lastName, country, accountNumber, dob, postcode, premise, street, town });
    this.billingDetailsSubmitted.set(true);
    await this.initialisePaymentForm(this.linkParams);
  }

  // ── Outcome (return from Trust Payments) ────────────────────────────────────

  /**
   * Called when the browser returns from Trust Payments (via the backend /callback
   * 302 redirect to /pay?transactionId=...). Fetches the stored result and shows a
   * success/failure banner. On failure we show the billing-details step again
   * (pre-filled) so the user can retry inline.
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
      // if sessionStorage was lost (e.g. new tab). Prefer the result for display, but
      // carry the signature from saved params — the retry re-calls /initiate, which
      // (with AIMS_VERIFY_REDIRECT on) requires the original `sig`. The result has no
      // signature and the return URL only carries transactionId, so without this the
      // retry is rejected as "invalid payment link".
      const saved = this.readSavedParams();
      const params: PaymentParams | null =
        (result.amount != null && result.currency)
          ? {
              partnerId:      result.partnerId,
              amount:         result.amount,
              currency:       result.currency,
              orderReference: result.orderReference,
              signature:      saved?.signature
            }
          : saved;

      if (params) {
        this.applyParams(params);
      }

      if (result.status === 'SUCCESS') {
        // Payment done — no need to keep the params around.
        this.clearSavedParams();
        return;
      }

      // Failed → show the billing-details step again (pre-filled) so the customer can retry.
      if (params) {
        this.linkParams = params;
        this.billingDetailsSubmitted.set(false);
        this.isFormRendered.set(false);
        this.prefillBillingDetails();
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

      // Request signed JWT from backend using the payment-link params + billing details
      const { jwt, transactionId } = await this.paymentApiService
        .initiatePayment({
          partnerId:         params.partnerId,
          amount:            params.amount,
          currency:          params.currency,
          orderReference:    params.orderReference,
          signature:         params.signature,
          billingFirstName:      this.billingFirstName().trim(),
          billingLastName:       this.billingLastName().trim(),
          billingCountry:        this.billingCountry().trim().toUpperCase(),
          customerAccountNumber: this.billingAccountNumber().trim(),
          billingDob:            this.billingDob().trim(),
          billingPostcode:       this.billingPostcode().trim(),
          billingPremise:        this.billingPremise().trim(),
          billingStreet:         this.billingStreet().trim(),
          billingTown:           this.billingTown().trim()
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
      animatedCard: true,
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
    // Reset to the billing-details step (pre-filled) rather than re-initialising directly.
    this.linkParams = saved;
    this.isFormRendered.set(false);
    this.isFormValid.set(false);
    this.billingDetailsSubmitted.set(false);
    this.billingError.set(null);
    this.status.set('IDLE');
    this.errorMessage.set(null);
    this.applyParams(saved);
    this.prefillBillingDetails();
  }
}
