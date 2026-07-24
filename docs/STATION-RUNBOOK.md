# Content Station — Shop Runbook

Print this and keep it near the phone. Written for whoever is in the shop —
no technical knowledge needed.

---

## One-time setup (5 minutes)

1. Install **TestFlight** from the App Store, then install **Content Station**
   from the TestFlight invitation.
2. Plug the phone into power. Leave it plugged in always.
3. Connect it to the shop Wi-Fi.
4. Mount it somewhere with a good view of the shop — counter height or higher,
   pointing at where things happen (the counter, the aisles, the entrance).
5. Open Content Station. It says **Connected** at the bottom by itself —
   there is nothing to sign in to.
6. Pick how often to film (30m is a good start) and press **START**.
7. **Lock the app open** so nobody can close it by accident:
   - Settings → Accessibility → Guided Access → turn ON
   - Set a passcode the owner knows
   - Back in Content Station, triple-click the side button → tap Start

That's everything. The phone films a short clip on the schedule and sends it
automatically. Nobody needs to touch it again.

## What the screen tells you

| Screen says | Meaning | Do |
|---|---|---|
| **RUNNING · Next clip in …** | Working normally | Nothing |
| **Charger unplugged** (orange) | Someone knocked the cable out | Plug it back in |
| **Battery low and unplugged** (red) | Power has been out a while | Nothing — it recovers when power returns |
| **Storage almost full** (red) | Wi-Fi has been down for days | Check the Wi-Fi router |
| **Phone too hot** (red) | Sun or heat | Move it out of the sun |
| **Not connected** (red, bottom) | No internet | Check Wi-Fi; clips are saved and send later |
| **STOPPED** | Someone pressed Stop | Press START |

The screen dims by itself after a minute — that is normal, not off. Tap it to
brighten.

## If the electricity goes out

Nothing to do during the cut: the phone runs on its battery and keeps saving
clips. If the battery gets low it pauses filming by itself.

**After power comes back, check the phone once.** If it died completely, it
will restart on its own when charging resumes, but the app will not reopen by
itself:

1. Unlock the phone
2. Open **Content Station**
3. Check it says **RUNNING** (press START if not)
4. Triple-click the side button → Start, to lock the app open again

This is the only situation that needs a person.

## If Wi-Fi is out for a long time

Also nothing to do. Clips are stored on the phone and upload automatically
when internet returns — even days later. Nothing is lost.

## Rules of thumb

- Never unplug the phone to charge something else
- Don't move it once the owner is happy with the angle
- The phone films the shop — tell staff, and mention it to customers if asked
- If something looks wrong and this sheet doesn't cover it: close the app,
  reopen it, press START. That fixes almost everything.

---

*Owner side: check the station's health any time with*
`cd apps/backend && npx tsx pair.mts` *— it shows battery, charging, disk,
queue and whether it is filming.*
