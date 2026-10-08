import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemoryCacheService } from '../common/cache/memory-cache.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

export interface Province {
  code: string;
  name: string;
}

export interface Ward {
  code: string;
  name: string;
  province_code: string;
}

/** Administrative units change rarely: cache for a day. */
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_PREFIX = 'address:';
const REQUEST_TIMEOUT_MS = 8_000;

/** Upstream payloads (provinces.open-api.vn v2, 2-level structure after the 07/2025 reform). */
interface UpstreamProvince {
  code: number | string;
  name: string;
  wards?: { code: number | string; name: string }[];
}

class ProvinceNotFound extends Error {}

/**
 * Vietnamese administrative-address lookup.
 *
 * The external provider (https://provinces.open-api.vn, API v2: provinces → wards)
 * is fully contained in this class: to switch provider, only `fetchProvinces`
 * and `fetchProvinceWithWards` need to change. Nothing is stored in PostgreSQL.
 */
@Injectable()
export class AddressService {
  private readonly logger = new Logger(AddressService.name);
  private readonly baseUrl: string;

  constructor(
    config: ConfigService,
    private readonly cache: MemoryCacheService,
  ) {
    this.baseUrl = config
      .get<string>('ADDRESS_API_BASE_URL', 'https://provinces.open-api.vn/api/v2')
      .replace(/\/+$/, '');
  }

  getProvinces(): Promise<Province[]> {
    return this.cache.wrap(`${CACHE_PREFIX}provinces`, CACHE_TTL_SECONDS, async () => {
      const data = await this.request<UpstreamProvince[]>('/p/');
      return data
        .map((p) => ({ code: String(p.code), name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    });
  }

  async getWards(provinceCode: string): Promise<Ward[]> {
    if (!/^\d{1,6}$/.test(provinceCode)) {
      throw AppException.notFound(ErrorCode.PROVINCE_NOT_FOUND, 'Province not found');
    }
    return this.cache.wrap(`${CACHE_PREFIX}wards:${provinceCode}`, CACHE_TTL_SECONDS, async () => {
      try {
        const province = await this.request<UpstreamProvince>(`/p/${provinceCode}?depth=2`);
        return (province.wards ?? [])
          .map((w) => ({
            code: String(w.code),
            name: w.name,
            province_code: String(province.code),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      } catch (err) {
        if (err instanceof ProvinceNotFound) {
          throw AppException.notFound(ErrorCode.PROVINCE_NOT_FOUND, 'Province not found');
        }
        throw err;
      }
    });
  }

  /**
   * Checks that the ward belongs to the province and returns the canonical names.
   * Returns `null` when the combination is invalid, and `undefined` when the
   * provider is unreachable (callers may then accept the client's values so a
   * third-party outage does not block checkout).
   */
  async verify(
    provinceCode: string,
    wardCode: string,
  ): Promise<{ provinceName: string; wardName: string } | null | undefined> {
    try {
      const provinces = await this.getProvinces();
      const province = provinces.find((p) => p.code === provinceCode);
      if (!province) return null;
      const ward = (await this.getWards(provinceCode)).find((w) => w.code === wardCode);
      return ward ? { provinceName: province.name, wardName: ward.name } : null;
    } catch (err) {
      if (err instanceof AppException && err.code === ErrorCode.PROVINCE_NOT_FOUND) return null;
      this.logger.warn({ err }, 'Address verification skipped: provider unavailable');
      return undefined;
    }
  }

  private async request<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error({ err, path }, 'Address provider request failed');
      throw this.providerError();
    }
    if (res.status === 404) throw new ProvinceNotFound();
    if (!res.ok) {
      this.logger.error({ path, status: res.status }, 'Address provider returned an error');
      throw this.providerError();
    }
    return (await res.json()) as T;
  }

  private providerError() {
    return new AppException(
      HttpStatus.BAD_GATEWAY,
      ErrorCode.ADDRESS_PROVIDER_ERROR,
      'Address service is temporarily unavailable',
    );
  }
}
