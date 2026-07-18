// src/environments/environment.prod.ts — Production
export const environment = {
  production: true,
  apiBaseUrl: '/api',  // Same-origin: nginx serves the app and proxies /api to the backend
  trustPaymentsCdnUrl: 'https://cdn.eu.trustpayments.com/js/latest/st.js',
  // 0 = Trust Payments TEST/sandbox gateway (no real money).
  // Must match the backend's TP_LIVE_STATUS (both test together, or both live together).
  liveStatus: 0
};
