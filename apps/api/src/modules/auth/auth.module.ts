import { Module } from '@nestjs/common';

import { EmailModule } from '../notifications/email/email.module';
import { UsersModule } from '../users/users.module';
import { AccountPasswordController } from './account-password.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OriginGuard } from './guards/origin.guard';
import { RolesGuard } from './guards/roles.guard';
import { MfaController } from './mfa/mfa.controller';
import { MfaGuard } from './mfa/mfa.guard';
import { MfaService } from './mfa/mfa.service';
import { OneTimeTokenService } from './one-time-token.service';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

@Module({
  imports: [UsersModule, EmailModule],
  controllers: [AuthController, AccountPasswordController, MfaController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    RefreshTokenService,
    OneTimeTokenService,
    MfaService,
    JwtAuthGuard,
    RolesGuard,
    MfaGuard,
    OriginGuard,
  ],
  exports: [TokenService, JwtAuthGuard, RolesGuard, MfaGuard, MfaService, RefreshTokenService],
})
export class AuthModule {}
