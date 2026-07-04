// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'payment',
    pathMatch: 'full'
  },
  {
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
    redirectTo: 'payment'
  }
];
