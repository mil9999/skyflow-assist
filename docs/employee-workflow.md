# Employee monitoring and takeover

This is a local demonstration using fictional passengers. Run `npm run setup:demo` after pulling migrations, restart the development server, and open `/simulator` and `/employee` in separate tabs on the same local origin.

## Complete a passenger journey

1. Start a simulator conversation. Select its card in the employee workspace to monitor saved messages and backend activity. A support case appears as **Needs assistance**.
2. Choose **Take over**. Further AI booking actions are refused by the backend. The passenger sees **Employee text support**. If this was a voice conversation, its AI transport disconnects when the browser detects takeover; staff assistance continues by text.
3. Ask the passenger for their booking reference and surname. For the successful fictional case, use `SKY82Q` / `Martin`. If identity is unverified, enter those details and choose **Verify identity**, then **Load disrupted booking**. Taking over after failed verification does not bypass identity checks.
4. Choose **Find alternatives**, then **Hold this flight**. The employee sees departure, arrival, and hold deadline in UTC. Holding a seat does not change the booking.
5. Send the exact flight number, date, departure and arrival times, time zone, and any additional charge to the passenger. Obtain an explicit yes for that flight. Check **Passenger explicitly confirmed this exact flight after read-back**, then **Confirm change**. The checkbox and server request refer to that exact hold; replacement holds require fresh approval.
6. Send the confirmed flight and assigned seat to the passenger. Confirmed bookings survive disconnect and hold-expiry sweeps. Mark any open support cases resolved when assistance is complete.

The simulator's interactive fake provider gives canned replies. The three scripted scenario buttons demonstrate full automated workflows and reset the fictional data before each run. Do not reset the demo during an employee journey, since reset removes its sessions and transcript.

## Review escalated cases

`SKY55T` / `Okafor` has no eligible replacement flights. The AI can create a support case, and an employee can take over to explain the situation by text. This demo does not provide refunds, compensation, real airline inventory, or an external contact-centre connection.

After an escalation, **Take over** or **Resume employee review** restores the appropriate review stage and records an audit event. Staff still use the normal booking services. A failed employee identity check may escalate again; resume review and verify correctly before loading a booking.

## Persistence and operating limits

Completed text turns, voice tool responses, shared messages, employee control, support cases, and audit events are saved in the ignored local SQLite database. Older text checkpoints are copied into shared history when an employee joins. The simulator restores its current conversation after a page reload within the same browser tab. A new voice page starts a new remote connection.

A process interrupted during an AI operation leaves that operation locked to avoid replaying a booking change. Staff can take over and use the authoritative booking state; automatic AI mid-operation recovery is not implemented. Employee holds remain subject to expiry. The development worker sweeps at startup and every 30 seconds, with `npm run holds:expire` available manually.

The employee and shared conversation endpoints require a loopback development host, reject foreign origins, and are disabled in production. This is not an employee authentication system. Login, access controls, durable hosted storage, and a production expiry scheduler are required before hosting.
