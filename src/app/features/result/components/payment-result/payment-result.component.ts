// src/app/features/result/components/payment-result/payment-result.component.ts
import {
  Component,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { PaymentApiService } from '../../../payment/services/payment-api.service';
import { PaymentResultResponse } from '../../../../shared/models/payment.models';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-payment-result',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './payment-result.component.html',
  styleUrls: ['./payment-result.component.scss']
})
export class PaymentResultComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly paymentApiService = inject(PaymentApiService);

  readonly result = signal<PaymentResultResponse | null>(null);
  readonly isLoading = signal(true);
  readonly fetchError = signal<string | null>(null);

  readonly isSuccess = () => this.result()?.status === 'SUCCESS';

  ngOnInit(): void {
    const transactionId = this.route.snapshot.paramMap.get('transactionId');

    if (!transactionId) {
      this.router.navigate(['/payment']);
      return;
    }

    this.paymentApiService.getTransactionResult(transactionId).subscribe({
      next: (res) => {
        this.result.set(res);
        this.isLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.fetchError.set(
          err.error?.userMessage ?? 'Could not retrieve payment result.'
        );
        this.isLoading.set(false);
      }
    });
  }

  goBackToPayment(): void {
    this.router.navigate(['/payment']);
  }
}
