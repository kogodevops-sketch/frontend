// src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Defensive: remove any service worker registered by earlier debugging attempts.
// A stale SW intercepting Trust Payments requests will break the payment iframes.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
    .catch(() => {});
}

bootstrapApplication(AppComponent, appConfig)
  .catch(err => console.error('[Bootstrap Error]', err));
