-- Two states that trapped, and the rule that had to stop existing twice.
--
-- 1. ACCEPTING A DIETARY DISCLOSURE CHANGED NOTHING.
--    create_booking parks a booking carrying a disclosure at
--    compatibility_status 'pending', and settled_booking_status maps that to
--    booking status 'payment_authorized'. decide_dietary_compatibility then
--    wrote compatibility_status and only compatibility_status -- so accepting
--    left the booking exactly where it was. complete_dinner refuses to
--    complete while any booking sits in payment_authorized (SF040), and only
--    the traveller can cancel their own seat. One guest with an allergy
--    therefore froze the entire dinner, the host's payout included, with no
--    action available to anyone. Accepting now advances the booking through
--    the same settled_booking_status rule a payment would.
--
-- 2. A DECLINED DISCLOSURE HAD NO EXIT AT ALL.
--    Declining is the right answer when a household genuinely cannot feed
--    someone safely, but it left the seat frozen in the same way, and
--    cancel_booking enforces primary_traveler_id = p_profile_id, so no
--    operator could release it. cancel_booking_by_platform is that exit.
--
-- 3. THE PLATFORM-CANCELLATION MONEY RULE EXISTED IN ONE PLACE AND WAS ABOUT
--    TO EXIST IN TWO. Rather than copy the loop body out of
--    cancel_published_table, it is lifted into platform_cancel_one_booking and
--    both callers use it. Migration 0018 was written to end exactly this
--    class of defect and says so in its own header; re-creating it here to
--    save an extraction would be the worst kind of irony.
--
-- Reuses SF002 for a booking that cannot be cancelled from its state --
-- cancel_booking already means precisely that -- rather than minting a code
-- for a predicate that exists.

-- ---------------------------------------------------------------------------
-- The platform-cancellation money rule, in one place
--
-- Returns the refund owed. 100% back and no host compensation is a decided
-- rule, not configuration (docs/DECISIONS.md), so it is written here rather
-- than read from a policy row. What IS corrected: the refund now subtracts
-- refunds already recorded against this booking, because refunds has been a
-- row-per-refund table since 0015 and the previous code returned the whole
-- guest total regardless of what had already gone back.
-- ---------------------------------------------------------------------------
create or replace function public.platform_cancel_one_booking(
  p_operator_id uuid,
  p_booking_id uuid,
  p_reason text
)
returns integer
language plpgsql
as $$
declare
  p_booking public.bookings;
  v_was_paid boolean;
  v_refunded integer;
  v_refund integer;
begin
  -- Taken by id rather than as a composite so a FOR-loop row from the caller
  -- and a locked row from a single-booking caller behave identically. Both
  -- callers already hold the row lock in this transaction.
  select * into p_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking not found' using errcode = 'SF001';
  end if;

  v_was_paid := p_booking.payment_status in (
    'created', 'authorized', 'held', 'partially_refunded'
  );

  select coalesce(sum(amount_kurus), 0) into v_refunded
  from public.refunds where booking_id = p_booking.id;

  v_refund := case
    when v_was_paid then greatest(0, p_booking.guest_total_kurus - v_refunded)
    else 0
  end;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = p_reason,
      refund_status = case when v_was_paid then 'requested' else refund_status end,
      refund_due_kurus = v_refund,
      host_compensation_kurus = 0
  where id = p_booking.id;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason,
    previous_state, new_state
  ) values (
    p_operator_id, 'booking.cancelled_by_platform', 'booking', p_booking.id,
    p_reason,
    jsonb_build_object('status', p_booking.status),
    jsonb_build_object(
      'status', 'cancelled',
      'refund_due_kurus', v_refund,
      'already_refunded_kurus', v_refunded,
      'was_paid', v_was_paid
    )
  );

  return v_refund;
end;
$$;

create or replace function public.cancel_published_table(
  p_operator_id uuid,
  p_table_id uuid,
  p_reason text
)
returns table (
  table_id uuid,
  bookings_cancelled integer,
  refund_due_total_kurus bigint,
  payouts_held integer
)
language plpgsql
as $$
declare
  v_table public.hosted_tables;
  v_previous public.hosted_table_status;
  v_booking record;
  v_refund integer;
  v_cancelled integer := 0;
  v_refund_total bigint := 0;
  v_payouts_held integer;
begin
  perform public.assert_operator(p_operator_id);

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'cancelling a dinner requires a reason' using errcode = 'SF025';
  end if;

  select * into v_table from public.hosted_tables
  where id = p_table_id
  for update;

  if not found then
    raise exception 'table not found' using errcode = 'SF001';
  end if;

  -- Draft and submitted tables have host- and review-side paths already;
  -- completed, cancelled, and archived dinners are settled history.
  if v_table.status not in (
    'approved', 'published', 'minimum_reached', 'confirmed', 'roster_locked'
  ) then
    raise exception 'this table cannot be platform-cancelled from its current state'
      using errcode = 'SF027';
  end if;

  v_previous := v_table.status;

  for v_booking in
    select * from public.bookings
    where hosted_table_id = p_table_id
      and status in (
        'draft', 'awaiting_payment', 'payment_authorized',
        'pending_minimum', 'confirmed'
      )
    for update
  loop
    v_refund := public.platform_cancel_one_booking(
      p_operator_id, v_booking.id, p_reason
    );
    v_cancelled := v_cancelled + 1;
    v_refund_total := v_refund_total + v_refund;
  end loop;

  update public.hosted_tables
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = p_reason
  where id = p_table_id;

  -- Money for a dinner that never happened must not leave. Held, not deleted:
  -- the operator resolves each one deliberately, on the payout screen.
  update public.payout_records
  set status = 'held',
      hold_reason = 'Dinner cancelled: ' || p_reason
  where hosted_table_id = p_table_id
    and status <> 'released';

  get diagnostics v_payouts_held = row_count;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason,
    previous_state, new_state
  ) values (
    p_operator_id, 'hosted_table.cancelled_by_platform', 'hosted_table',
    p_table_id, p_reason,
    jsonb_build_object('status', v_previous),
    jsonb_build_object(
      'status', 'cancelled',
      'bookings_cancelled', v_cancelled,
      'refund_due_total_kurus', v_refund_total,
      'payouts_held', v_payouts_held
    )
  );

  return query select p_table_id, v_cancelled, v_refund_total, v_payouts_held;
end;
$$;
create or replace function public.decide_dietary_compatibility(
  p_operator_id uuid,
  p_booking_id uuid,
  p_decision text,
  p_private_reason text default null
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
  v_next public.compatibility_status;
  v_table public.hosted_tables;
  v_previous public.booking_status;
begin
  perform public.assert_operator(p_operator_id);

  if p_decision not in ('accepted', 'declined') then
    raise exception 'unknown compatibility decision' using errcode = 'SF025';
  end if;

  select * into v_booking from public.bookings
  where id = p_booking_id for update;

  if not found then
    raise exception 'booking not found' using errcode = 'SF001';
  end if;

  if v_booking.compatibility_status <> 'pending' then
    raise exception 'this booking is not awaiting a compatibility decision'
      using errcode = 'SF025';
  end if;

  v_next := p_decision::public.compatibility_status;
  v_previous := v_booking.status;

  insert into public.dietary_compatibility_decisions (
    booking_id, status, reviewer_profile_id, private_reason
  ) values (p_booking_id, v_next, p_operator_id, p_private_reason);

  update public.bookings
  set compatibility_status = v_next
  where id = p_booking_id
  returning * into v_booking;

  -- Accepting used to change nothing but this one column. The booking stayed
  -- at payment_authorized, complete_dinner refuses to complete around that
  -- (SF040), and only the traveller could cancel their own seat -- so one
  -- guest with a dietary disclosure froze the whole dinner, the host's payout
  -- included. A decision that clears the way has to actually clear it.
  --
  -- A plain select, not `for update`: cancel_published_table locks the table
  -- before its bookings, and taking them in the other order here would invite
  -- a deadlock between two operators working the same dinner.
  if v_next = 'accepted' and v_booking.status = 'payment_authorized' then
    select * into v_table from public.hosted_tables
    where id = v_booking.hosted_table_id;

    update public.bookings
    set status = public.settled_booking_status(v_booking, v_table)
    where id = p_booking_id
    returning * into v_booking;
  end if;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id,
    previous_state, new_state
  ) values (
    p_operator_id, 'dietary_compatibility.' || p_decision, 'booking',
    p_booking_id,
    jsonb_build_object('compatibility_status', 'pending', 'status', v_previous),
    -- The decision, never the disclosure or the reviewer's private note.
    jsonb_build_object('compatibility_status', v_next, 'status', v_booking.status)
  );

  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- An operator ending one seat
--
-- The dinner still goes ahead; this seat does not. The money rule is the
-- platform-cancellation one, because the platform is the party ending it --
-- see docs/OPEN_QUESTIONS.md for the question of whether a single seat ended
-- late should be treated differently from a cancelled dinner.
--
-- Seats return to the table, which cancel_published_table does not need to do
-- because it closes the table outright.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking_by_platform(
  p_operator_id uuid,
  p_booking_id uuid,
  p_reason text
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
  v_refund integer;
begin
  perform public.assert_operator(p_operator_id);

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'platform cancellation requires a reason'
      using errcode = 'SF025';
  end if;

  select * into v_booking from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking not found' using errcode = 'SF001';
  end if;

  -- The same denylist cancel_booking uses, so a traveller-cancelled and an
  -- operator-cancelled booking agree on what "already finished" means.
  if v_booking.status in ('cancelled', 'refunded', 'completed') then
    raise exception 'booking cannot be cancelled from its current state'
      using errcode = 'SF002';
  end if;

  v_refund := public.platform_cancel_one_booking(
    p_operator_id, v_booking.id, p_reason
  );

  update public.hosted_tables
  set available_seats = least(
        available_seats + v_booking.party_size,
        certified_capacity
      )
  where id = v_booking.hosted_table_id;

  select * into v_booking from public.bookings where id = p_booking_id;
  return v_booking;
end;
$$;
