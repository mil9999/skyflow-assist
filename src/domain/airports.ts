/**
 * Spoken airport names. The agent must never guess what a code means, so the
 * server supplies the words alongside the code.
 */
const AIRPORTS: Record<string, string> = {
  LHR: "London Heathrow",
  LGW: "London Gatwick",
  CDG: "Paris Charles de Gaulle",
  ORY: "Paris Orly",
  AMS: "Amsterdam Schiphol",
  BCN: "Barcelona",
  JFK: "New York JFK",
  DUB: "Dublin",
  FRA: "Frankfurt",
  MAD: "Madrid",
};

/** Falls back to the code itself rather than inventing a city. */
export function airportName(code: string): string {
  return AIRPORTS[code] ?? code;
}
