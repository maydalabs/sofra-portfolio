-- A host can save a text revision before submitting, including after an
-- operator requests changes. This does not change the table's review state,
-- schedule, capacity, price, slug, or the operator's private review notes.
-- SF045: invalid table content.

create or replace function public.revise_hosted_table_draft(
  p_profile_id uuid,
  p_table_id uuid,
  p_menu_title text,
  p_menu_description text,
  p_atmosphere text,
  p_expected_household_participants text,
  p_practical_information text,
  p_accessibility_information text
)
returns public.hosted_tables
language plpgsql
as $$
declare
  v_table public.hosted_tables;
  v_changed_fields text[];
  -- ECMAScript String.trim(): the same whitespace used by Zod's .trim().
  v_trim_characters constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  -- Serialize a save with submission/review, and keep household suspension
  -- from changing underneath the certification checks in this transaction.
  select t.* into v_table
  from public.hosted_tables t
  join public.households h on h.id = t.household_id
  where t.id = p_table_id and h.owner_profile_id = p_profile_id
  for update of t, h;

  if not found then
    raise exception 'table not found for this host' using errcode = 'SF001';
  end if;

  if v_table.status not in ('draft', 'changes_requested') then
    raise exception 'only a draft or changes-requested table may be revised'
      using errcode = 'SF002';
  end if;

  if not exists (
    select 1 from public.households h
    where h.id = v_table.household_id and h.status = 'certified'
  ) then
    raise exception 'no certified household for this host' using errcode = 'SF011';
  end if;

  perform 1 from public.host_certifications c
  where c.household_id = v_table.household_id and c.status = 'active'
    and (c.valid_from is null or c.valid_from <= now())
    and (c.valid_until is null or c.valid_until > now())
  for share;

  if not found then
    raise exception 'no active certification' using errcode = 'SF012';
  end if;

  -- Match the trimmed host-form text bounds, including empty optional
  -- accessibility information. Null is not an empty string.
  p_menu_title := btrim(p_menu_title, v_trim_characters);
  p_menu_description := btrim(p_menu_description, v_trim_characters);
  p_atmosphere := btrim(p_atmosphere, v_trim_characters);
  p_expected_household_participants := btrim(p_expected_household_participants, v_trim_characters);
  p_practical_information := btrim(p_practical_information, v_trim_characters);
  p_accessibility_information := btrim(p_accessibility_information, v_trim_characters);

  if exists (
    select 1
    from (values
      (p_menu_title, 5, 100),
      (p_menu_description, 30, 1200),
      (p_atmosphere, 10, 240),
      (p_expected_household_participants, 10, 240),
      (p_practical_information, 10, 500),
      (p_accessibility_information, 0, 500)
    ) as content(value, minimum_length, maximum_length)
    where value is null
      -- JavaScript counts UTF-16 code units: a supplementary character such
      -- as an emoji is two units, although PostgreSQL char_length counts one.
      or char_length(value) + regexp_count(value, U&'[\+010000-\+10FFFF]')
        not between minimum_length and maximum_length
  ) then
    raise exception 'table content is outside the allowed text bounds'
      using errcode = 'SF045';
  end if;

  v_changed_fields := array_remove(array[
    case when v_table.menu_title is distinct from p_menu_title then 'menu_title' end,
    case when v_table.menu_description is distinct from p_menu_description then 'menu_description' end,
    case when v_table.atmosphere is distinct from p_atmosphere then 'atmosphere' end,
    case when v_table.expected_household_participants is distinct from p_expected_household_participants then 'expected_household_participants' end,
    case when v_table.practical_information is distinct from p_practical_information then 'practical_information' end,
    case when v_table.accessibility_information is distinct from p_accessibility_information then 'accessibility_information' end
  ], null);

  update public.hosted_tables
  set menu_title = p_menu_title,
      menu_description = p_menu_description,
      atmosphere = p_atmosphere,
      expected_household_participants = p_expected_household_participants,
      practical_information = p_practical_information,
      accessibility_information = p_accessibility_information
  where id = p_table_id
  returning * into v_table;

  insert into public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, previous_state, new_state
  ) values (
    p_profile_id, 'hosted_table.draft_revised', 'hosted_table', v_table.id,
    jsonb_build_object('status', v_table.status),
    jsonb_build_object('status', v_table.status, 'changed_fields', v_changed_fields)
  );

  return v_table;
end;
$$;
