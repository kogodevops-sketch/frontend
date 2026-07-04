import { Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TrustPaymentsLoaderService {
  private loadPromise: Promise<void> | null = null;

  load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById('st-js-script');
      if (existing) existing.remove();

      const script = document.createElement('script');
      script.id = 'st-js-script';
      script.src = environment.trustPaymentsCdnUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this.loadPromise = null;
        reject(new Error('Failed to load Trust Payments st.js'));
      };
      document.head.appendChild(script);
    });

    return this.loadPromise;
  }

  reset(): void {
    this.loadPromise = null;
  }
}
