-- Reaching everyone whose dinner was cancelled.
--
-- cancel_published_table reports counts -- bookings cancelled, refund owed,
-- payouts held -- which is what the operator screen needs and not enough to
-- write to anyone. A cancelled dinner is the single most important thing this
-- product can have to say to a person, so it needs the guests themselves.
--
-- Scoped to cancelled bookings on one table, and carrying only what the
-- notification says: who, where to write, which language, and the dinner's
-- public face.

create or replace function public.get_cancelled_table_traveller_contacts(
  p_table_id uuid
)
returns table (
  profile_id uuid,
  display_name text,
  email text,
  preferred_locale text,
  menu_title text,
  starts_at timestamptz,
  public_neighborhood text
)
language sql
stable
as $$
  select distinct
    c.profile_id, c.display_name, c.email, c.preferred_locale,
    t.menu_title, t.starts_at, t.public_neighborhood
  from public.bookings b
  join public.hosted_tables t on t.id = b.hosted_table_id
  join public.get_profile_contacts(array[b.primary_traveler_id]) c on true
  where b.hosted_table_id = p_table_id
    and b.status = 'cancelled';
$$;

comment on function public.get_cancelled_table_traveller_contacts(uuid) is
  'Travellers whose booking on this table is cancelled, for notification only. Carries no address, no other guest, and no money.';
