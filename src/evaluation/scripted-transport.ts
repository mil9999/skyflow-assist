import type { EvaluationTransport } from "./voice-runner";

/** Harness rehearsal only. These scripted replies do not evaluate a model. */
export class ScriptedEvaluationTransport implements EvaluationTransport {
  private tool!: (name: string, args: Record<string, unknown>) => Promise<string>;
  private turn = 0;
  constructor(private scenario: string) {}
  async start(tool: (name: string, args: Record<string, unknown>) => Promise<string>) { this.tool = tool; }
  async exchange() {
    const turn = this.turn++;
    if (this.scenario === "failed-verification") {
      await this.tool("verify_passenger_identity", { bookingReference: "SKY82Q", lastName: turn === 0 ? "Dubois" : "Duval" });
      return turn === 0 ? "Those details did not match. Please try again." : "I have created a support case for identity review.";
    }
    if (turn === 0) {
      await this.tool("verify_passenger_identity", { bookingReference: this.scenario === "no-alternatives" ? "SKY55T" : "SKY82Q", lastName: this.scenario === "no-alternatives" ? "Okafor" : "Martin" });
      await this.tool("get_disrupted_booking", {});
      await this.tool("search_alternative_flights", {});
      if (this.scenario === "no-alternatives") {
        await this.tool("transfer_to_human_agent", { reason: "NO_ALTERNATIVE_FLIGHTS" });
        return "No eligible flight is available. I have created a support case for employee review.";
      }
      return "I found three eligible alternatives.";
    }
    if (turn === 1) {
      await this.tool("hold_selected_flight", { optionId: "option_1" });
      return "SF218 is held, departing tomorrow at 13:00 UTC and arriving 15:15 UTC with no extra charge. Do you confirm?";
    }
    if (turn === 2 && this.scenario === "employee-takeover") return "An employee controls the booking. Please continue by text in the employee assistance panel.";
    if (this.scenario === "expired-hold") {
      if (turn === 2) {
        await this.tool("search_alternative_flights", {});
        return "The old hold expired. Here are the alternatives again; a new hold and confirmation are needed.";
      }
      if (turn === 3) {
        await this.tool("hold_selected_flight", { optionId: "option_1" });
        return "SF218 is held again, departing tomorrow at 13:00 UTC and arriving at 15:15 UTC. Do you confirm this new hold?";
      }
    } else if (turn === 2) return "Please give a clear yes before I change the booking.";
    await this.tool("confirm_flight_rebooking", { confirmed: true });
    return "Your booking is confirmed on SF218.";
  }
  async end() {}
}
