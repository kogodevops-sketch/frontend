// src/environments/environment.ts  — Development
export const environment = {
  production: false,
  // NOTE: app must be opened via http://trustpay.local:4200 (NOT localhost/127.0.0.1).
  // Trust Payments' CDN blocks "localhost" and "127.0.0.1" as iframe origins, so the
  // card-field iframes 404. Any other hostname works — trustpay.local maps to 127.0.0.1
  // via /etc/hosts. See README / setup notes.
  apiBaseUrl: 'http://trustpay.local:8080/api',
  trustPaymentsCdnUrl: 'https://cdn.eu.trustpayments.com/js/latest/st.js',
  // 0 = Trust Payments TEST gateway. Must stay 0 for local/dev.
  liveStatus: 0
};
