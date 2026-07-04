// src/app/core/interceptors/http-error.interceptor.ts
import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

export const httpErrorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let userMessage = 'An unexpected error occurred. Please try again.';

      if (error.status === 0) {
        userMessage = 'Unable to reach the server. Please check your connection.';
      } else if (error.status === 400) {
        userMessage = error.error?.message ?? 'Invalid request.';
      } else if (error.status === 404) {
        userMessage = 'The requested resource was not found.';
      } else if (error.status === 500) {
        userMessage = 'A server error occurred. Please try again later.';
      }

      // Attach a human-readable message to the error for components to display
      const enrichedError = new HttpErrorResponse({
        error: { ...error.error, userMessage },
        headers: error.headers,
        status: error.status,
        statusText: error.statusText,
        url: error.url ?? undefined
      });

      return throwError(() => enrichedError);
    })
  );
};
