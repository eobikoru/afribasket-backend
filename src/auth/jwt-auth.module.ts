import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { AppConfig } from '../config/configuration';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('jwt', { infer: true }).accessSecret,
        signOptions: { expiresIn: config.get('jwt', { infer: true }).accessTtl as `${number}${'s' | 'm' | 'h' | 'd'}` },
      }),
    }),
  ],
  exports: [JwtModule],
})
export class JwtAuthModule {}
