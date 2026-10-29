import type {
  GeocodingGateway,
  GeocodingOutcome,
} from '../../domain/location/GeocodingGateway';

/** Caché en memoria por query normalizada; no cachea errores (se puede reintentar). */
export class CachedGeocodingGateway implements GeocodingGateway {
  private readonly cache = new Map<string, GeocodingOutcome>();

  public constructor(private readonly inner: GeocodingGateway) {}

  public async lookup(query: string): Promise<GeocodingOutcome> {
    const key = query.trim().toLowerCase();
    const hit = this.cache.get(key);
    if (hit !== undefined && hit.ok) {
      return hit;
    }
    const outcome = await this.inner.lookup(query);
    if (outcome.ok) {
      this.cache.set(key, outcome);
    }
    return outcome;
  }

  public clear(): void {
    this.cache.clear();
  }
}