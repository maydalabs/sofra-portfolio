-- Who to tell, and in which language.
--
-- The application sends exactly one email in its whole lifetime: the sign-in
-- link. Every other thing that happens to a person -- their seat confirmed,
-- their dinner cancelled, their host application decided -- happens in
-- silence, discoverable only if they think to log in and look.
--
-- Sending mail needs three facts about a recipient and no others: what to
-- call them, where to write, and which language to write in. These read
-- models return exactly those. An email address is contact data, not
-- profile data, and lives on the auth table; joining it here keeps that join
-- in one reviewed place instead of scattered through the repositories.
--
-- Deliberately absent from every projection below: dietary disclosures,
-- addresses, other guests, money, and assessment notes. A notification is
-- one of the easiest ways to leak something sensitive to the wrong inbox,
-- and the cheapest defence is not to select it in the first place.

create or replace function public.get_profile_contacts(
  p_profile_ids uuid[]
)
returns table (
  profile_id uuid,
  display_name text,
  email text,
  preferred_locale text
)
language sql
stable
as $$
  select p.id, p.display_name, u.email, p.preferred_locale
  from public.profiles p
  join public."user" u on u.id = p.auth_user_id
  where p.id = any(p_profile_ids)
    and u.email is not null;
$$;

comment on function public.get_profile_contacts(uuid[]) is
  'Name, address and language for a set of people, and nothing else. The only sanctioned way to reach profiles from the notification layer.';

-- ---------------------------------------------------------------------------
-- The two people a booking concerns
--
-- Returns the traveller and the household's owning host with the role each
-- plays, so a caller never has to guess which contact is which.
-- ---------------------------------------------------------------------------
create or replace function public.get_booking_notification_contacts(
  p_booking_id uuid
)
returns table (
  party text,
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
  with booking as (
    select b.id, b.primary_traveler_id, t.menu_title, t.starts_at,
           t.public_neighborhood, h.owner_profile_id
    from public.bookings b
    join public.hosted_tables t on t.id = b.hosted_table_id
    join public.households h on h.id = t.household_id
    where b.id = p_booking_id
  )
  select 'traveller'::text, c.profile_id, c.display_name, c.email,
         c.preferred_locale, b.menu_title, b.starts_at, b.public_neighborhood
  from booking b
  join public.get_profile_contacts(array[b.primary_traveler_id]) c on true
  union all
  select 'host'::text, c.profile_id, c.display_name, c.email,
         c.preferred_locale, b.menu_title, b.starts_at, b.public_neighborhood
  from booking b
  join public.get_profile_contacts(array[b.owner_profile_id]) c on true;
$$;

comment on function public.get_booking_notification_contacts(uuid) is
  'The traveller and host a booking concerns, with only the dinner context an email needs: menu title, time, neighbourhood. Never the address, the guests, the dietary text, or the money.';
