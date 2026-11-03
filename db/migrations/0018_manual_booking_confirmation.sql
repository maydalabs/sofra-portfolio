-- Confirming a booking without a card payment.
--
-- Until now the string 'confirmed' was produced in exactly one place in the
-- whole schema: record_payment_authorized. With no payment provider every
-- booking stayed 'draft' forever, and everything downstream hung off that --
-- the host roster returns only confirmed and completed bookings, so a host
-- never saw a guest; complete_dinner found no confirmed roster to attest to;
-- and with no completion there were no reviews, no incident reports and no
-- payout rows. The whole second half of the product was unreachable behind a
-- payment rail that does not exist yet.
--
-- This does not invent a payment method. It records the fact an operator can
-- actually attest to -- that a seat is confirmed for a real dinner -- and,
-- separately and explicitly, on what settlement basis.
--
--   'none'          Sofra collected nothing. payment_status stays
--                   not_started, so cancel_booking correctly computes no
--                   refund: there is nothing to give back.
--   'off_platform'  Sofra received the money outside the card rail. Recorded
--                   through the existing ledger as provider_code 'manual', so
--                   refunds, holds and reconciliation all keep working.
--
-- IMPORTANT, and deliberately not decided here: collecting traveller money
-- into the company's own account as an intermediary is the one structure
-- docs/DECISIONS.md rules out, because holding third-party funds without a
-- licence is a criminal exposure under Law 6493. 'off_platform' exists to
-- record money that was lawfully received; it does not make an unlawful
-- arrangement lawful, and the default is 'none'.
--
-- New SQLSTATE: SF043 (booking cannot be confirmed), SF044 (unknown basis).

-- ---------------------------------------------------------------------------
-- The one place the post-settlement status is decided
--
-- This rule previously existed twice -- in SQL inside record_payment_authorized
-- and in TypeScript as statusAfterPayment() -- and adding a second SQL caller
-- would have made a third copy to drift. Both SQL paths now call this.
-- ---------------------------------------------------------------------------
create or replace function public.settled_booking_status(
  p_booking public.bookings,
  p_table public.hosted_tables
)
returns public.booking_status
language plpgsql
immutable
as $$
declare
  v_minimum_reached boolean;
begin
  -- A pending dietary assessment parks the booking: somebody must decide
  -- whether the menu is compatible before this dinner is confirmed.
  if p_booking.compatibility_status = 'pending' then
    return 'payment_authorized';
  end if;

  v_minimum_reached :=
    (p_table.certified_capacity - p_table.available_seats)
      >= p_table.minimum_guest_count;

  if p_table.format = 'private'
    or p_table.guaranteed_operation
    or v_minimum_reached
    or p_table.status in ('minimum_reached', 'confirmed') then
    return 'confirmed';
  end if;

  return 'pending_minimum';
end;
$$;

create or replace function public.record_payment_authorized(
  p_profile_id uuid,
  p_booking_id uuid,
  p_provider_code text,
  p_provider_reference text,
  p_provider_payment_id text,
  p_provider_item_reference text,
  p_amount_kurus integer,
  p_simulated boolean default false
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
  v_table public.hosted_tables;
  v_existing public.payment_records;
  v_previous public.booking_status;
  v_next public.booking_status;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking not found' using errcode = 'SF001';
  end if;

  select * into v_existing from public.payment_records
  where provider_reference = p_provider_reference;

  if found then
    if v_existing.booking_id <> p_booking_id then
      raise exception 'provider reference belongs to another booking'
        using errcode = 'SF034';
    end if;
    -- Webhook retry or double-read of the same settlement: already recorded.
    return v_booking;
  end if;

  if v_booking.status not in ('draft', 'awaiting_payment') then
    raise exception 'booking is not awaiting payment' using errcode = 'SF034';
  end if;

  if v_booking.payment_status not in ('not_started', 'created', 'failed') then
    raise exception 'booking already has a live payment' using errcode = 'SF034';
  end if;

  -- The provider is told what to charge; it does not get to define it. The
  -- only acceptable amount is the one this database computed at booking time.
  if p_amount_kurus <> v_booking.guest_total_kurus then
    raise exception 'paid amount % does not match booking total %',
      p_amount_kurus, v_booking.guest_total_kurus
      using errcode = 'SF033';
  end if;

  select * into v_table from public.hosted_tables
  where id = v_booking.hosted_table_id;

  v_next := public.settled_booking_status(v_booking, v_table);

  insert into public.payment_records (
    booking_id, provider_code, provider_reference, provider_payment_id,
    provider_item_reference, amount_kurus, currency, status, is_simulated
  ) values (
    p_booking_id, p_provider_code, p_provider_reference,
    p_provider_payment_id, p_provider_item_reference,
    p_amount_kurus, v_booking.currency, 'authorized', p_simulated
  );

  v_previous := v_booking.status;

  update public.bookings
  set status = v_next,
      payment_status = 'authorized'
  where id = p_booking_id
  returning * into v_booking;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason,
    previous_state, new_state
  ) values (
    p_profile_id, 'payment.authorized', 'booking', v_booking.id, null,
    jsonb_build_object('status', v_previous),
    jsonb_build_object(
      'status', v_booking.status,
      'payment_status', v_booking.payment_status,
      'provider_code', p_provider_code,
      'amount_kurus', p_amount_kurus,
      'simulated', p_simulated
    )
  );

  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operator confirmation
-- ---------------------------------------------------------------------------
create or replace function public.confirm_booking_manually(
  p_operator_id uuid,
  p_booking_id uuid,
  p_settlement_basis text,
  p_reference text default null,
  p_reason text default null
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
  v_table public.hosted_tables;
  v_previous public.booking_status;
  v_next public.booking_status;
begin
  perform public.assert_operator(p_operator_id);

  if p_settlement_basis not in ('none', 'off_platform') then
    raise exception 'unknown settlement basis %', p_settlement_basis
      using errcode = 'SF044';
  end if;

  if p_settlement_basis = 'off_platform'
    and (p_reference is null or length(trim(p_reference)) = 0) then
    raise exception 'money received off-platform must carry a reference'
      using errcode = 'SF044';
  end if;

  select * into v_booking from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking not found' using errcode = 'SF001';
  end if;

  if v_booking.status not in ('draft', 'awaiting_payment') then
    raise exception 'booking is not awaiting confirmation' using errcode = 'SF043';
  end if;

  -- A booking that already carries a live payment belongs to the payment
  -- path, not to this one.
  if v_booking.payment_status not in ('not_started', 'failed') then
    raise exception 'booking already has a live payment' using errcode = 'SF043';
  end if;

  select * into v_table from public.hosted_tables
  where id = v_booking.hosted_table_id;

  if v_table.status not in
    ('published', 'minimum_reached', 'confirmed', 'roster_locked') then
    raise exception 'the table is not open for confirmation' using errcode = 'SF043';
  end if;

  v_previous := v_booking.status;
  v_next := public.settled_booking_status(v_booking, v_table);

  if p_settlement_basis = 'off_platform' then
    -- Routed through the ledger rather than around it, so the money model
    -- stays single-sourced: the amount is the one the database computed at
    -- booking time, and refunds and holds keep working unchanged.
    perform public.record_payment_authorized(
      p_operator_id,
      p_booking_id,
      'manual',
      p_reference,
      null,
      null,
      v_booking.guest_total_kurus,
      false
    );
    select * into v_booking from public.bookings where id = p_booking_id;
  else
    update public.bookings
    set status = v_next
    where id = p_booking_id
    returning * into v_booking;
  end if;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason,
    previous_state, new_state
  ) values (
    p_operator_id, 'booking.confirmed_manually', 'booking', v_booking.id,
    p_reason,
    jsonb_build_object('status', v_previous),
    jsonb_build_object(
      'status', v_booking.status,
      'payment_status', v_booking.payment_status,
      'settlement_basis', p_settlement_basis,
      'money_collected_by_sofra', p_settlement_basis = 'off_platform'
    )
  );

  return v_booking;
end;
$$;
