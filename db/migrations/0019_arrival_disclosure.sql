-- Telling a confirmed guest where the dinner actually is.
--
-- arrival_instructions and the exact address had exactly one reader in the
-- whole application -- the host's own address form -- so a traveller with a
-- confirmed seat could not learn where to go. The booking screen promised
-- disclosure "at the appropriate confirmed stage" and no such stage existed.
--
-- WHEN that stage falls is an open product decision: docs/OPEN_QUESTIONS.md
-- carries "exact point and channel for disclosing arrival instructions", and
-- this migration does not resolve it. It builds the mechanism and expresses
-- the timing as pricing-policy configuration, the way every other launch
-- hypothesis in this schema is expressed. The default below is a starting
-- number, not an answer: early enough to plan the journey, late enough that a
-- seat booked weeks ahead does not hand out a home address weeks ahead.
--
-- The disclosure itself is deliberately narrow. It answers one question for
-- one person -- where is my dinner -- and returns nothing else: no household
-- notes, no verification notes, no coordinates, no other guest.

alter table public.pricing_policies
  add column if not exists arrival_disclosure_hours_before integer not null
    default 48
    check (arrival_disclosure_hours_before between 0 and 336);

comment on column public.pricing_policies.arrival_disclosure_hours_before is
  'Hours before the dinner at which a confirmed traveller may see the exact address. A launch hypothesis, not a resolved policy: see docs/OPEN_QUESTIONS.md.';

-- ---------------------------------------------------------------------------
-- The traveller's own arrival details
--
-- Scoped by the caller's profile id, never by a value the caller supplies for
-- someone else, and gated on three things at once: the booking is theirs, the
-- seat is actually confirmed, and the disclosure window has opened. Anything
-- short of all three returns no row rather than a partial answer.
-- ---------------------------------------------------------------------------
create or replace function public.get_booking_arrival_details(
  p_profile_id uuid,
  p_booking_id uuid
)
returns table (
  booking_id uuid,
  starts_at timestamptz,
  disclosed boolean,
  disclose_from timestamptz,
  address_line_1 text,
  address_line_2 text,
  district text,
  city text,
  postal_code text,
  arrival_instructions text
)
language sql
stable
as $$
  with scoped as (
    select
      b.id as booking_id,
      b.status,
      t.starts_at,
      t.id as table_id,
      t.household_id,
      coalesce(p.arrival_disclosure_hours_before, 48) as hours_before
    from public.bookings b
    join public.hosted_tables t on t.id = b.hosted_table_id
    left join public.pricing_policies p on p.id = t.pricing_policy_id
    where b.id = p_booking_id
      and b.primary_traveler_id = p_profile_id
  ),
  windowed as (
    select
      s.*,
      s.starts_at - make_interval(hours => s.hours_before) as disclose_from,
      s.status in ('confirmed', 'completed')
        and now() >= s.starts_at - make_interval(hours => s.hours_before)
        as disclosed
    from scoped s
  )
  select
    w.booking_id,
    w.starts_at,
    w.disclosed,
    w.disclose_from,
    -- The address itself is selected only once the window is open. Before
    -- that the caller learns when to come back, and nothing about where.
    case when w.disclosed then a.address_line_1 end,
    case when w.disclosed then a.address_line_2 end,
    case when w.disclosed then a.district end,
    case when w.disclosed then a.city end,
    case when w.disclosed then a.postal_code end,
    case when w.disclosed then a.arrival_instructions end
  from windowed w
  left join public.household_private_addresses a
    on a.household_id = w.household_id;
$$;

comment on function public.get_booking_arrival_details(uuid, uuid) is
  'A confirmed traveller''s own arrival details, and nothing else. Returns the address only inside the disclosure window; otherwise reports when it opens. Excludes coordinates, verification notes, household internals, and every other guest.';
