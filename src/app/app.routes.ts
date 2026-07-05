// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'pay',
    pathMatch: 'full'
  },
  {
    // Hosted payment link, e.g.
    //   /pay?partner_id=AIMS_PROD_001&amount=249.99&currency=GBP&reference_id=INV-2024-00842
    path: 'pay',
    loadComponent: () =>
      import('./features/payment/components/payment/payment.component')
        .then(m => m.PaymentComponent),
    title: 'Secure Payment'
  },
  {
    // Legacy alias — same component.
    path: 'payment',
    loadComponent: () =>
      import('./features/payment/components/payment/payment.component')
        .then(m => m.PaymentComponent),
    title: 'Secure Payment'
  },
  {
    path: 'result/:transactionId',
    loadComponent: () =>
      import('./features/result/components/payment-result/payment-result.component')
        .then(m => m.PaymentResultComponent),
    title: 'Payment Result'
  },
  {
    path: '**',
    redirectTo: 'pay'
  }
];
