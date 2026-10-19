import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors/app.exception';
import { SettingsService } from '../settings/settings.service';
import { quoteShipping, type ShippingResult } from './shipping.rates';
import type { ShippingMethodName, ShippingQuote } from './shipping.types';

@Injectable()
export class ShippingService {
  constructor(private readonly settings: SettingsService) {}

  async quote(input: {
    subtotalCents: number;
    totalWeightOz: number;
    state: string;
    hasColdChain: boolean;
    method: ShippingMethodName;
  }): Promise<ShippingQuote> {
    const result = await this.evaluate(input);
    if (!result.ok) {
      throw Errors.unprocessable(result.message, { allowedMethods: result.allowedMethods, code: result.code });
    }
    return result.quote;
  }

  async evaluate(input: {
    subtotalCents: number;
    totalWeightOz: number;
    state: string;
    hasColdChain: boolean;
    method: ShippingMethodName;
  }): Promise<ShippingResult> {
    const settings = await this.settings.shippingSettings();
    return quoteShipping({ ...input, settings });
  }
}
