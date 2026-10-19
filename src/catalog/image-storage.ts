import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { AppConfig } from '../config/configuration';
import { Errors } from '../common/errors/app.exception';

export interface StoredImage {
  url: string;
  publicId: string;
}

@Injectable()
export class ImageStorage {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async upload(data: Buffer, folder: string): Promise<StoredImage> {
    const credentials = this.config.get('cloudinary', { infer: true });
    if (!credentials) throw Errors.unavailable('Image storage is not configured');
    const mime = detectImage(data);
    if (!mime) throw Errors.badRequest('Upload a JPEG, PNG, or WebP image');
    cloudinary.config({
      cloud_name: credentials.cloudName,
      api_key: credentials.apiKey,
      api_secret: credentials.apiSecret,
      secure: true,
    });
    const uploaded = await cloudinary.uploader.upload(`data:${mime};base64,${data.toString('base64')}`, {
      folder: `afribasket/${folder}`,
      resource_type: 'image',
    });
    return { url: uploaded.secure_url, publicId: uploaded.public_id };
  }

  async destroy(publicId: string): Promise<void> {
    const credentials = this.config.get('cloudinary', { infer: true });
    if (!credentials || !publicId) return;
    cloudinary.config({
      cloud_name: credentials.cloudName,
      api_key: credentials.apiKey,
      api_secret: credentials.apiSecret,
      secure: true,
    });
    await cloudinary.uploader.destroy(publicId);
  }
}

export function detectImage(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length > 8 && buffer.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
