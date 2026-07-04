// src/environments/environment.prod.ts — Production
export const environment = {
  production: true,
  apiBaseUrl: '/api',  // Same-origin in prod (reverse proxy / container)
  trustPaymentsCdnUrl: 'https://cdn.eu.trustpayments.com/js/latest/st.js'
};
