# Open questions

These are unresolved product or production decisions. Development defaults must not be mistaken for final answers.

Questions for a Turkish lawyer, raised by the payment and market research that
is held privately — these gate launch geography and the safety hold:

- Does the KMK md. 24 unanimous-consent requirement attach to a recurring paid
  home dinner, or only to a permanent conversion of the flat — and do müstakil
  (detached) houses escape it entirely? If detached houses are clear, launch
  geography is decided by building type, not neighbourhood.
- Does the ETAHS Yönetmelik md. 11/5 carve-out confirm that a safety-incident
  hold may exceed the five-business-day payout deadline?

- Final brand name and identity system
- First launch neighborhoods (demo neighborhoods are fictional launch hypotheses only)
- Permanent certified-capacity policy
- What is a single seat worth when the PLATFORM ends it? The refund policy
  decides a cancelled _dinner_ (100%, no host compensation) and a traveller
  cancellation (100% / 50% / 0%). It says nothing about the platform ending one
  seat — a dietary compatibility declined after the booking cutoff, say.
  `cancel_booking_by_platform` (migration 0022) currently applies the
  cancelled-dinner rule: 100% back, no host compensation. That is a starting
  position, not the answer, and it is the reason the rule was extracted into
  `platform_cancel_one_booking` where it can be changed in one place.
- Is the host compensated when the platform ends one seat late, with the dinner
  still going ahead? Today they are not.
- Should a seat confirmed on settlement basis 'none' produce a payout
  obligation at all? `complete_dinner` sums the host's net across the confirmed
  roster without consulting `payment_status`, so a pilot dinner nobody paid for
  still creates a pending payout row. It is held, never released automatically,
  so no money moves — but the number is not money Sofra collected.
- What corrects a mistake? There is no reversal for a released payout, and
  `refund_status = 'declined'` has existed since the first schema with nothing
  that writes it. Recording is currently one-way.
- Who decides a shared table has missed its minimum, and with what tool? The
  refund policy says it is decided at the booking cutoff and refunded 100% the
  same business day, but nothing writes `minimum_reached` and nothing moves a
  booking out of `pending_minimum`, so that decision has no implementation.
- Final Sofra take rate
- Policy for one-traveler parties
- Final host active-table and frequency limits
- Guest phone or identity verification
- Final host certification rubric and renewal cadence
- Partner economics, attribution window, and settlement
- Production legal, tax, insurance, food-safety, privacy, and consumer-compliance decisions
- Exact point and channel for disclosing arrival instructions. The mechanism
  now exists (`get_booking_arrival_details`, migration 0019) and the timing is
  pricing-policy configuration, `arrival_disclosure_hours_before`, defaulting
  to 48 hours before the dinner for a confirmed booking. That default is a
  starting number, not the answer: the point and the channel are still open.
- Content moderation and translation-review operations
