export type GeocodingResult = Readonly<{
  label: string;
  latitude: number;
  longitude: number;
}>;

export type GeocodingErrorKind =
  | 'invalid_query'
  | 'incomplete'
  | 'invalid_coordinates'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'server'
  | 'http';

export type GeocodingOutcome =
  | Readonly<{ ok: true; value: GeocodingResult }>
  | Readonly<{ ok: false; error: { kind: GeocodingErrorKind; status?: number } }>;

export type GeocodingGateway = {
  lookup(query: string): Promise<GeocodingOutcome>;
};