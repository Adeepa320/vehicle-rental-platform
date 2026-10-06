import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema';
import { BookingsModule } from '../bookings/bookings.module';
import { EmailModule } from '../notifications/email/email.module';
import { FakeGatewayController } from './fake-gateway.controller';
import { FAKE_MERCHANT_SECRET_DEFAULT, FakeGateway } from './gateway/fake.gateway';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway';
import { PayHereMerchantApi } from './gateway/payhere-merchant-api';
import { PayHereGateway } from './gateway/payhere.gateway';
import { PaymentNotificationsController } from './payment-notifications.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Payments module (ARCHITECTURE §10, TECH_DECISIONS D53): the gateway is chosen
 * from `PAYMENT_GATEWAY` — PayHere with the configured merchant credentials, or
 * the deterministic fake gateway for tests and local development (refused in
 * production by the environment schema).
 */
@Module({
  imports: [BookingsModule, EmailModule],
  controllers: [PaymentsController, PaymentNotificationsController, FakeGatewayController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentGateway => {
        const gateway = config.get('PAYMENT_GATEWAY', { infer: true });
        const apiPublicUrl = config.get('API_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
        if (gateway === 'fake') {
          return new FakeGateway({
            merchantSecret:
              config.get('PAYHERE_MERCHANT_SECRET', { infer: true }) ??
              FAKE_MERCHANT_SECRET_DEFAULT,
            checkoutUrl: `${apiPublicUrl}/payments/fake/checkout`,
          });
        }
        const environment = config.get('PAYHERE_ENVIRONMENT', { infer: true });
        const merchantId = config.get('PAYHERE_MERCHANT_ID', { infer: true });
        const merchantSecret = config.get('PAYHERE_MERCHANT_SECRET', { infer: true });
        if (!merchantId || !merchantSecret) {
          throw new Error(
            'PAYHERE_MERCHANT_ID and PAYHERE_MERCHANT_SECRET are required for the payhere gateway',
          );
        }
        const appId = config.get('PAYHERE_APP_ID', { infer: true });
        const appSecret = config.get('PAYHERE_APP_SECRET', { infer: true });
        return new PayHereGateway({
          environment,
          merchantId,
          merchantSecret,
          ...(appId && appSecret
            ? { merchantApi: new PayHereMerchantApi({ environment, appId, appSecret }) }
            : {}),
        });
      },
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
