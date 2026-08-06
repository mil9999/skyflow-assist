import { prisma } from "@/server/db/prisma";
import { findAlternatives, isAlternativeEligible, type Flight } from "@/domain/rebooking";

// Always read fresh data from the database on each page load.
export const dynamic = "force-dynamic";

const time = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(d);

const day = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);

const WHY: Record<string, string> = {
  SAME_FLIGHT: "This is the cancelled flight itself",
  NOT_SCHEDULED: "This flight is cancelled too",
  ORIGIN_MISMATCH: "Departs from a different airport",
  DESTINATION_MISMATCH: "Goes somewhere else",
  NO_SEATS: "No seats left",
  ALREADY_DEPARTED: "Already took off",
  INVALID_TIMES: "Bad timetable data",
  NOT_DIRECT: "Not a direct flight",
  ARRIVES_TOO_LATE: "Arrives too late",
};

export default async function Home() {
  const disrupted = await prisma.booking.findMany({
    where: { status: "DISRUPTED" },
    include: { passenger: true, flight: true },
    orderBy: { bookingReference: "asc" },
  });

  const allFlights = await prisma.flight.findMany({ orderBy: { departureTime: "asc" } });

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100 sm:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="border-b border-slate-800 pb-5">
          <p className="text-xs uppercase tracking-widest text-sky-400">SkyFlow Airlines</p>
          <h1 className="mt-1 text-3xl font-semibold">Disruption board</h1>
          <p className="mt-2 text-sm text-slate-400">
            Live from your database. The green flights are the only ones the voice agent will ever be
            allowed to offer.
          </p>
        </header>

        {disrupted.map((booking) => {
          const original = booking.flight as Flight;
          const offered = findAlternatives(original, allFlights as Flight[]);
          const offeredIds = new Set(offered.map((o) => o.flight.id));

          const rejected = (allFlights as Flight[])
            .filter((f) => !offeredIds.has(f.id))
            .map((f) => ({ flight: f, decision: isAlternativeEligible(original, f) }))
            .filter((r) => !r.decision.ok)
            .slice(0, 5);

          return (
            <section
              key={booking.id}
              className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60"
            >
              {/* Passenger + cancelled flight */}
              <div className="border-b border-slate-800 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xl font-medium">
                    {booking.passenger.firstName} {booking.passenger.lastName}
                  </h2>
                  <span className="rounded bg-slate-800 px-2 py-1 font-mono text-sm text-sky-300">
                    {booking.bookingReference}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                  <span className="rounded bg-red-500/15 px-2 py-1 font-medium text-red-300">
                    CANCELLED
                  </span>
                  <span className="font-mono">{original.flightNumber}</span>
                  <span className="text-slate-300">
                    {original.origin} → {original.destination}
                  </span>
                  <span className="text-slate-400">
                    {day(original.departureTime)}, {time(original.departureTime)} –{" "}
                    {time(original.arrivalTime)}
                  </span>
                  <span className="text-slate-500">seat {booking.seatNumber}</span>
                </div>
              </div>

              {/* What the agent may offer */}
              <div className="p-5">
                <h3 className="text-xs uppercase tracking-wider text-slate-400">
                  Allowed alternatives ({offered.length})
                </h3>

                {offered.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                    Nothing available. The agent must hand this passenger to a human.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {offered.map(({ optionId, flight }) => (
                      <li
                        key={optionId}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm"
                      >
                        <span className="font-mono font-medium text-emerald-300">
                          {flight.flightNumber}
                        </span>
                        <span>
                          {time(flight.departureTime)} → {time(flight.arrivalTime)}
                        </span>
                        <span className="text-slate-400">
                          {flight.stops === 0 ? "direct" : `${flight.stops} stop`}
                        </span>
                        <span className="text-slate-400">{flight.availableSeats} seats left</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* What the rulebook threw out, and why */}
                {rejected.length > 0 && (
                  <>
                    <h3 className="mt-6 text-xs uppercase tracking-wider text-slate-500">
                      Rejected by the rulebook
                    </h3>
                    <ul className="mt-2 space-y-1">
                      {rejected.map(({ flight, decision }) => (
                        <li
                          key={flight.id}
                          className="flex flex-wrap items-center gap-x-3 rounded px-4 py-2 text-sm text-slate-500"
                        >
                          <span className="font-mono line-through">{flight.flightNumber}</span>
                          <span className="line-through">
                            {flight.origin} → {flight.destination}
                          </span>
                          <span className="text-slate-600">
                            {!decision.ok && (WHY[decision.reason] ?? decision.reason)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </section>
          );
        })}

        <footer className="border-t border-slate-800 pt-5 text-sm text-slate-500">
          Phase 1 complete. No AI yet — every flight above was chosen by{" "}
          <code className="text-slate-400">src/domain/rebooking.ts</code>, not by a language model.
        </footer>
      </div>
    </main>
  );
}
