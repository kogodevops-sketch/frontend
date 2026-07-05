// src/environments/environment.prod.ts — Production
export const environment = {
  production: true,
  apiBaseUrl: '/api',  // Same-origin in prod (reverse proxy / container)
  trustPaymentsCdnUrl: 'https://cdn.eu.trustpayments.com/js/latest/st.js',
  // 1 = Trust Payments LIVE gateway. Real cards, real money.
  // Must match the backend's trustpayments.live-status (both live together).
  liveStatus: 1
};
