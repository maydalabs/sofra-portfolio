-- Money and state-integrity corrections found by the 2026-09-09 audit.
--
-- Five defects, all of the same shape: a later migration added a state or a
-- guarantee, and an earlier function that reasons about the same rows was
-- never revisited.
--
--   1. release_payout would release a payout that cancel_published_table had
--      deliberately held, paying a host in full for a dinner that never
--      happened -- on top of the 100% refunds already owed to every guest.
--      The rule existed in TypeScript (assertPayoutCanRelease) and had no
--      production caller. It lives in SQL now, where it cannot be bypassed.
--   2. record_payment_refund had no replay guard, so a retried provider
--      webhook refunded twice. Its two sibling functions already guard this.
--   3. Both cancellation paths tested payment_status against a list written
--      before 0015 added 'partially_refunded', so a traveller who had taken a
--      partial refund and then cancelled was silently owed nothing.
--   4. complete_dinner did not count 'draft' among unresolved bookings -- and
--      'draft' is the state every booking is created in -- so an abandoned
--      booking kept its seat forever once the table closed.
--   5. Releasing a hold had no path at all: hold_payout could set 'held' and
--      nothing could clear it except the release this migration now forbids.
--
-- New SQLSTATE: SF041 (payout is held), SF042 (nothing to lift).

-- A provider reference identifies one refund at the provider. Recording it
-- twice is always a mistake, so the database refuses it even if a caller
-- skips the check inside record_payment_refund.
create unique index if not exists refunds_provider_reference_key
  on public.refunds (provider_reference)
  where provider_reference is not null;

create or replace function public.release_payout(
  p_operator_id uuid,
  p_payout_id uuid,
  p_reason text default null
)
returns public.payout_records
language plpgsql
as $$
declare
  v_payout public.payout_records;
  v_previous public.payout_status;
  v_open_incidents integer;
begin
  perform public.assert_operator(p_operator_id);

  select * into v_payout from public.payout_records
  where id = p_payout_id for update;

  if not found then
    raise exception 'payout not found' using errcode = 'SF023';
  end if;

  if v_payout.status = 'released' then
    raise exception 'payout is already released' using errcode = 'SF025';
  end if;

  select count(*) into v_open_incidents
  from public.safety_incidents i
  where i.hosted_table_id = v_payout.hosted_table_id
    and i.status not in ('resolved', 'closed');

  if v_open_incidents > 0 then
    raise exception 'an open safety incident blocks this payout'
      using errcode = 'SF026';
  end if;

  -- Checked after the incident so that a payout held *because* of an incident
  -- reports the incident, which is the condition the operator must actually
  -- resolve. A hold is a deliberate decision -- by an operator, or by the
  -- platform cancelling the dinner -- and releasing straight through it pays
  -- for a dinner that did not happen. It has to be lifted on its own terms
  -- first, which is what lift_payout_hold is for.
  if v_payout.status = 'held' then
    raise exception 'a held payout must have its hold lifted before release'
      using errcode = 'SF041';
  end if;

  v_previous := v_payout.status;

  update public.payout_records
  set status = 'released', released_at = now(), hold_reason = null
  where id = p_payout_id
  returning * into v_payout;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason,
    previous_state, new_state
  ) values (
    p_operator_id, 'payout.released', 'payout', v_payout.id, p_reason,
    jsonb_build_object('status', v_previous),
    jsonb_build_object('status', v_payout.status, 'amount_kurus', v_payout.amount_kurus)
  );

  return v_payout;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lifting a payout hold
--
-- The counterpart to hold_payout, and the only way out of 'held'. It refuses
-- while a safety incident is still open, and lands on 'eligible' rather than
-- 'released' so that releasing stays a separate, audited decision. This is
-- the transition determinePayoutStatus() in TypeScript always described and
-- no SQL function performed.
-- ---------------------------------------------------------------------------
create or replace function public.lift_payout_hold(
  p_operator_id uuid,
  p_payout_id uuid,
  p_reason text
)
returns public.payout_records
language plpgsql
as $$
declare
  v_payout public.payout_records;
  v_previous public.payout_status;
  v_open_incidents integer;
begin
  perform public.assert_operator(p_operator_id);

  select * into v_payout from public.payout_records
  where id = p_payout_id for update;

  if not found then
    raise exception 'payout not found' using errcode = 'SF023';
  end if;

  if v_payout.status <> 'held' then
    raise exception 'only a held payout has a hold to lift'
      using errcode = 'SF042';
  end if;

  select count(*) into v_open_incidents
  from public.safety_incidents i
  where i.hosted_table_id = v_payout.hosted_table_id
    and i.status not in ('resolved', 'closed');

  if v_open_incidents > 0 then
    raise exception 'an open safety incident blocks this payout'
      using errcode = 'SF026';
  end if;

  v_previous := v_payout.status;

  update public.payout_records
  set status = 'eligible', hold_reason = null
  where id = p_payout_id
  returning * into v_payout;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason,
    previous_state, new_state
  ) values (
    p_operator_id, 'payout.hold_lifted', 'payout', v_payout.id, p_reason,
    jsonb_build_object('status', v_previous, 'hold_reason', v_payout.hold_reason),
    jsonb_build_object('status', v_payout.status)
  );

  return v_payout;
end;
$$;
create or replace function public.record_payment_refund(
  p_profile_id uuid,
  p_booking_id uuid,
  p_amount_kurus integer,
  p_reason text,
  p_provider_reference text default null
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
  v_payment public.payment_records;
  v_total_refunded bigint;
begin
  if p_amount_kurus is null or p_amount_kurus <= 0 then
    raise exception 'refund amount must be positive' using errcode = 'SF035';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking not found' using errcode = 'SF001';
  end if;

  -- A provider retries a webhook until it gets a 2xx. Recording the same
  -- refund twice would pay the traveller twice, so a reference we have
  -- already seen is a no-op, exactly as the authorize and fail paths do.
  if p_provider_reference is not null and exists (
    select 1 from public.refunds where provider_reference = p_provider_reference
  ) then
    return v_booking;
  end if;

  if v_booking.payment_status not in ('authorized', 'held', 'partially_refunded') then
    raise exception 'booking has no refundable payment' using errcode = 'SF036';
  end if;

  select * into v_payment from public.payment_records
  where booking_id = p_booking_id and status = 'authorized'
  order by created_at desc
  limit 1;

  select coalesce(sum(amount_kurus), 0) + p_amount_kurus into v_total_refunded
  from public.refunds
  where booking_id = p_booking_id;

  if v_total_refunded > v_booking.guest_total_kurus then
    raise exception 'refund total % would exceed the % collected',
      v_total_refunded, v_booking.guest_total_kurus
      using errcode = 'SF035';
  end if;

  insert into public.refunds (
    booking_id, payment_record_id, amount_kurus, reason,
    provider_reference, created_by
  ) values (
    p_booking_id, v_payment.id, p_amount_kurus, p_reason,
    p_provider_reference, p_profile_id
  );

  update public.bookings
  set payment_status = case
        when v_total_refunded = guest_total_kurus
          then 'refunded'::public.payment_status
        else 'partially_refunded'::public.payment_status
      end,
      refund_status = case
        when refund_due_kurus > 0 and v_total_refunded >= refund_due_kurus
          then 'completed'
        else 'processing'
      end
  where id = p_booking_id
  returning * into v_booking;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason,
    previous_state, new_state
  ) values (
    p_profile_id, 'payment.refunded', 'booking', v_booking.id, p_reason,
    jsonb_build_object('payment_status',
      case when v_total_refunded = p_amount_kurus
        then 'authorized' else 'partially_refunded' end),
    jsonb_build_object(
      'payment_status', v_booking.payment_status,
      'refund_amount_kurus', p_amount_kurus,
      'total_refunded_kurus', v_total_refunded
    )
  );

  return v_booking;
end;
$$;
create or replace function public.cancel_booking(
  p_profile_id uuid,
  p_booking_id uuid,
  p_reason text default null
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
  v_table public.hosted_tables;
  v_policy public.pricing_policies;
  v_previous public.booking_status;
  v_before_cutoff boolean;
  v_bps integer;
  v_refund integer := 0;
  v_retained integer := 0;
  v_host_comp integer := 0;
  v_was_paid boolean;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking not found' using errcode = 'SF001';
  end if;

  if v_booking.primary_traveler_id <> p_profile_id then
    raise exception 'booking does not belong to this traveller' using errcode = 'SF008';
  end if;

  if v_booking.status in ('cancelled', 'refunded', 'completed') then
    raise exception 'booking cannot be cancelled from its current state' using errcode = 'SF002';
  end if;

  select * into v_table from public.hosted_tables
  where id = v_booking.hosted_table_id
  for update;

  v_before_cutoff := now() < v_table.booking_cutoff_at;

  -- The snapshot the traveller booked under governs their refund, not
  -- whatever the policy says today.
  select * into v_policy from public.pricing_policies
  where id = v_table.pricing_policy_id;

  v_bps := case when v_before_cutoff
    then coalesce(v_policy.refund_before_cutoff_basis_points, 10000)
    else coalesce(v_policy.refund_after_cutoff_basis_points, 5000) end;

  -- A refund is owed only on money actually collected. Until a payment
  -- provider exists every booking is not_started and this stays zero.
  v_was_paid := v_booking.payment_status in (
    'created', 'authorized', 'held', 'partially_refunded'
  );

  if v_was_paid then
    -- Ceiling division: rounding favours the traveller, the same way pricing
    -- rounding favours the host.
    v_refund := ((v_booking.guest_total_kurus::bigint * v_bps + 9999) / 10000)::integer;
    v_retained := v_booking.guest_total_kurus - v_refund;
    -- Host first, up to their net for these seats; the platform keeps the rest.
    v_host_comp := least(v_retained, v_booking.host_net_payout_kurus);
  end if;

  v_previous := v_booking.status;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = p_reason,
      refund_status = case when v_was_paid then 'requested' else refund_status end,
      refund_due_kurus = v_refund,
      host_compensation_kurus = v_host_comp
  where id = p_booking_id
  returning * into v_booking;

  update public.hosted_tables
  set available_seats = least(
        available_seats + v_booking.party_size,
        certified_capacity
      )
  where id = v_booking.hosted_table_id;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason,
    previous_state, new_state
  ) values (
    p_profile_id, 'booking.cancelled', 'booking', v_booking.id, p_reason,
    jsonb_build_object('status', v_previous),
    jsonb_build_object(
      'status', v_booking.status,
      'party_size', v_booking.party_size,
      'seats_returned', v_booking.party_size,
      'before_cutoff', v_before_cutoff,
      'refund_basis_points', v_bps,
      'was_paid', v_was_paid,
      'refund_due_kurus', v_refund,
      'host_compensation_kurus', v_host_comp
    )
  );

  return v_booking;
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
  v_was_paid boolean;
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
    v_was_paid := v_booking.payment_status in (
      'created', 'authorized', 'held', 'partially_refunded'
    );
    -- Platform cancellation: 100% back, nothing retained, so no host
    -- compensation. A rule, not a configuration.
    v_refund := case when v_was_paid then v_booking.guest_total_kurus else 0 end;

    update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = p_reason,
        refund_status = case when v_was_paid then 'requested' else refund_status end,
        refund_due_kurus = v_refund,
        host_compensation_kurus = 0
    where id = v_booking.id;

    insert into public.audit_logs (
      actor_profile_id, action, entity_type, entity_id, reason,
      previous_state, new_state
    ) values (
      p_operator_id, 'booking.cancelled_by_platform', 'booking', v_booking.id,
      p_reason,
      jsonb_build_object('status', v_booking.status),
      jsonb_build_object(
        'status', 'cancelled',
        'refund_due_kurus', v_refund,
        'refund_basis_points', 10000,
        'was_paid', v_was_paid
      )
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
create or replace function public.complete_dinner(
  p_host_id uuid,
  p_table_id uuid,
  p_attended_booking_ids uuid[],
  p_no_show_booking_ids uuid[]
)
returns table (
  attended_count integer,
  no_show_count integer,
  payout_amount_kurus integer,
  payout_id uuid
)
language plpgsql
as $$
declare
  v_table public.hosted_tables;
  v_confirmed_ids uuid[];
  v_listed_ids uuid[];
  v_unresolved integer;
  v_attended integer := 0;
  v_no_show integer := 0;
  v_payout_amount integer := 0;
  v_payout_id uuid;
  v_abandoned integer := 0;
begin
  select t.* into v_table
  from public.hosted_tables t
  join public.households h on h.id = t.household_id
  where t.id = p_table_id
    and h.owner_profile_id = p_host_id
  for update of t;

  if not found then
    raise exception 'table not found for this host' using errcode = 'SF001';
  end if;

  if v_table.status not in
    ('published', 'minimum_reached', 'confirmed', 'roster_locked') then
    raise exception 'table cannot be completed from status %', v_table.status
      using errcode = 'SF002';
  end if;

  if now() < v_table.starts_at then
    raise exception 'the dinner has not started yet' using errcode = 'SF038';
  end if;

  -- A draft booking never had a payment authorized -- that transition is
  -- what leaves 'draft' -- so nothing is owed on it and nobody is out of
  -- pocket. Left alone it would keep its seat forever once the table
  -- closes, so it is cancelled here rather than orphaned.
  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = 'Never paid; resolved when the dinner completed'
  where hosted_table_id = p_table_id
    and status = 'draft';

  get diagnostics v_abandoned = row_count;

  if v_abandoned > 0 then
    insert into public.audit_logs (
      actor_profile_id, action, entity_type, entity_id, reason,
      previous_state, new_state
    ) values (
      p_host_id, 'booking.abandoned_at_completion', 'hosted_table', p_table_id,
      null,
      jsonb_build_object('status', 'draft'),
      jsonb_build_object('status', 'cancelled', 'bookings', v_abandoned)
    );
  end if;

  -- A booking that was paid but never resolved (dietary review still
  -- pending, minimum never confirmed) holds a traveller's money. Completing
  -- around it would strand that money silently; it must be decided or
  -- cancelled first.
  select count(*) into v_unresolved
  from public.bookings b
  where b.hosted_table_id = p_table_id
    and b.status in ('awaiting_payment', 'payment_authorized', 'pending_minimum');

  if v_unresolved > 0 then
    raise exception '% unresolved bookings must be decided or cancelled first',
      v_unresolved
      using errcode = 'SF040';
  end if;

  -- Every confirmed booking must be accounted for, exactly once, and
  -- nothing else may be listed. The host attests to the whole roster or to
  -- none of it.
  select coalesce(array_agg(b.id), '{}') into v_confirmed_ids
  from public.bookings b
  where b.hosted_table_id = p_table_id
    and b.status = 'confirmed';

  p_attended_booking_ids := coalesce(p_attended_booking_ids, '{}');
  p_no_show_booking_ids := coalesce(p_no_show_booking_ids, '{}');
  v_listed_ids := p_attended_booking_ids || p_no_show_booking_ids;

  if cardinality(v_confirmed_ids) = 0 then
    raise exception 'no confirmed bookings to check in' using errcode = 'SF039';
  end if;

  if exists (select 1 from unnest(p_attended_booking_ids) a
             where a = any(p_no_show_booking_ids)) then
    raise exception 'a booking cannot be both attended and a no-show'
      using errcode = 'SF039';
  end if;

  -- Exact cover: same size, no id outside the confirmed roster, no
  -- confirmed booking left unlisted. Duplicates fail the size check.
  if cardinality(v_listed_ids) <> cardinality(v_confirmed_ids)
    or exists (select 1 from unnest(v_listed_ids) l
               where l <> all(v_confirmed_ids))
    or exists (select 1 from unnest(v_confirmed_ids) c
               where c <> all(v_listed_ids)) then
    raise exception 'the lists must cover exactly the confirmed roster'
      using errcode = 'SF039';
  end if;

  insert into public.booking_check_ins (
    booking_id, hosted_table_id, attended, confirmed_by
  )
  select b.id, p_table_id, b.id = any(p_attended_booking_ids), p_host_id
  from public.bookings b
  where b.id = any(v_listed_ids);

  update public.bookings b
  set status = 'completed', completed_at = now()
  where b.id = any(v_listed_ids);

  select count(*) filter (where a.id = any(p_attended_booking_ids)),
         count(*) filter (where a.id = any(p_no_show_booking_ids)),
         coalesce(sum(a.host_net_payout_kurus), 0)
  into v_attended, v_no_show, v_payout_amount
  from public.bookings a
  where a.id = any(v_listed_ids);

  update public.hosted_tables
  set status = 'completed'
  where id = p_table_id;

  -- The host's earnings for this dinner, as one payout the release job and
  -- the operator hold/release tooling already know how to handle. No-shows
  -- are included: under the decided policy their seats are paid in full.
  if v_payout_amount > 0 then
    insert into public.payout_records (
      hosted_table_id, household_id, amount_kurus, currency, status
    ) values (
      p_table_id, v_table.household_id, v_payout_amount, 'TRY', 'pending'
    )
    returning id into v_payout_id;
  end if;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason,
    previous_state, new_state
  ) values (
    p_host_id, 'dinner.completed', 'hosted_table', p_table_id, null,
    jsonb_build_object('status', v_table.status),
    jsonb_build_object(
      'status', 'completed',
      'attended_bookings', v_attended,
      'no_show_bookings', v_no_show,
      'payout_amount_kurus', v_payout_amount,
      'payout_id', v_payout_id
    )
  );

  return query select v_attended, v_no_show, v_payout_amount, v_payout_id;
end;
$$;
