# Test credentials

All test logins for ValetPay in one place. They only work in **demo mode**, which runs:

- on the demo sites: https://valetpay-demo.netlify.app and https://susheelsanagapalli.github.io/valet-parking-system/
- locally with `npm start` (demo data, `SEED_DEMO` not false)

The production site does not accept any of these. A test in `server/test/credentials-doc.test.ts` fails if this file no longer matches the demo accounts in `server/src/seedData.ts`, so keep the two in step.

## Staff accounts (demo mode)

Every demo account uses the password **`valet123`**.

| Username | Name | Role | What they can do |
| --- | --- | --- | --- |
| `platform` | Platform Admin | Platform admin | Everything, including approving payment QRs |
| `admin` | Operator Admin | Operator admin | Locations, settings, SMS, Google data, staff and roles |
| `supervisor` | Shift Supervisor | Supervisor | Attendant work plus VIP priority, re-park, QR payment checks, dashboard |
| `attendant` | Ravi (Attendant) | Attendant | Check in, park, queue, hand over, cash/card payments |
| `attendant2` | Meena (Attendant) | Attendant | Same as `attendant`, for testing two attendants at once |

All demo accounts can work at every demo location.

## Demo locations

| Location | Profile | Ticket prefix | Good for testing |
| --- | --- | --- | --- |
| Spice Garden Restaurant | Restaurant | SG | GPS spot, complimentary valet, no-damage confirmation |
| City Centre Parking | Paid parking | CC | Zone/slot, hourly fee, UPI QR and cash payments |
| Grand Palace Hotel | Hotel | GP | In-and-out stays, stay end date |

## Guest ticket pages and handover PINs

Guests don't have accounts. Each ticket has its own link (`/t/<token>`) and a 4-digit handover PIN, both created at check-in:

- **Demo mode:** the **Test credentials** panel on the sign-in page lists the open tickets with their guest links and PINs. The PIN is also shown once on the check-in screen.
- The two cars parked at start-up have their links and PINs in that panel too.

## Production

| | |
| --- | --- |
| Site | https://valetpay.onrender.com |
| Username | `admin` (platform admin) |
| Password | **Not stored in git.** This repository is public. The starting password was handed over privately and must be changed at first sign-in. Keep the current password in a password manager. |

On the free plan, production keeps data in memory. After every restart it goes back to just the `admin` account with its starting password, from the `staff-users.json` secret file on Render. To give production a new starting admin password:

```bash
npm run build
npm run staff-user -- --file staff-users.json --username admin --name "ValetPay Admin" --role platform_admin
```

Then replace the secret file `staff-users.json` in Render (valetpay → Environment → Secret Files) and redeploy. Never commit `staff-users.json`.

## Rules

- Test credentials are for demo mode only. Never use `valet123` or any password from this file for a real account.
- Never add production passwords, deploy hooks, API keys or tokens to this file or anywhere else in git.
