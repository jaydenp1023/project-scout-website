CREATE OR REPLACE FUNCTION public.scout_member_ranked_search(p_state text DEFAULT 'ALL'::text, p_source text DEFAULT 'all'::text, p_trade text DEFAULT 'all'::text, p_keyword text DEFAULT ''::text, p_deadline_days integer DEFAULT 0, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_city text DEFAULT ''::text, p_saved_only boolean DEFAULT false)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with params as (
   select upper(coalesce(nullif(p_state,''),'ALL')) as state,
          coalesce(nullif(p_source,''),'all') as source,
          coalesce(nullif(p_trade,''),'all') as trade,
          left(trim(coalesce(p_keyword,'')),80) as keyword,
          greatest(0,least(90,coalesce(p_deadline_days,0))) as deadline_days,
          greatest(1,least(100,coalesce(p_limit,60))) as max_rows,
          greatest(0,least(50000,coalesce(p_offset,0))) as offset_rows
 ),
 visible as (
 select o.*, cp.trade as business_trade, cp.city as business_city,
  cp.state as business_state, params.trade as requested_trade,
  params.keyword as requested_keyword,
  coalesce(nullif(p_city,''),case when upper(coalesce(cp.state,''))=o.state then cp.city else '' end,'') as target_city
 from public.opportunities o
 cross join params
 left join public.contractor_profiles cp on cp.user_id=(select auth.uid())
 where o.is_placeholder=false and o.duplicate_of is null
   and coalesce(o.status,'') !~* '(closed|cancelled|awarded|no award)'
   and (o.due_date is null or o.due_date>=current_date)
   and (params.state='ALL' or o.state=params.state)
   -- Reject obvious out-of-state federal titles rather than passing off an agency's
   -- home-office state as the actual worksite. This is conservative, not geocoding.
   and not (params.state<>'ALL' and o.source='sam_gov' and (
     (params.state<>'AZ' and o.title ~* '(^|[[:space:]])(AZ|Arizona)([[:space:]]|$)')
     or (params.state<>'TX' and o.title ~* '(^|[[:space:]])Texas([[:space:]]|$)')
     or (params.state<>'CA' and o.title ~* '(^|[[:space:]])California([[:space:]]|$)')
     or (params.state<>'FL' and o.title ~* '(^|[[:space:]])Florida([[:space:]]|$)')
     or (params.state<>'GA' and o.title ~* '(^|[[:space:]])Georgia([[:space:]]|$)')
     or o.title ~* '(^|[[:space:]])(Japan|Korea|Philippines|Germany|Afghanistan|Panama)([[:space:]]|$)'
   ))
   and (params.source='all' or (params.source='federal' and o.source='sam_gov') or (params.source='state' and o.source<>'sam_gov'))
   and (params.trade='all' or o.suggested_trade=params.trade)
   and (params.keyword='' or o.title ilike '%'||params.keyword||'%' or coalesce(o.agency,'') ilike '%'||params.keyword||'%' or coalesce(o.description,'') ilike '%'||params.keyword||'%')
   and (params.deadline_days=0 or (o.due_date>=current_date and o.due_date<=current_date+params.deadline_days))
   and (not coalesce(p_saved_only,false) or exists (select 1 from public.saved_opportunities so where so.user_id=(select auth.uid()) and so.opportunity_id=o.id))
 ),
 scored as (
 select v.*,
 least(100,greatest(15,
  10+
  case
   when lower(v.suggested_trade)=lower(coalesce(nullif(v.requested_trade,'all'),nullif(v.business_trade,''),''))
    then 45
   when v.requested_trade='all' and coalesce(v.business_trade,'')='' then 24
   when v.suggested_trade='General' then 15
   else 7 end+
  case when v.business_state is not null and upper(v.business_state)=v.state then 19
       when p_state<>'ALL' and upper(p_state)=v.state then 17
       else 3 end+
  case when v.target_city<>'' and v.city is not null and lower(trim(v.target_city))=lower(trim(v.city)) then 9 else 0 end+
  case when v.due_date between current_date and current_date+interval '30 days' then 5
       when v.due_date is not null then 2 else 0 end+
  case when v.posted_date between current_date-interval '21 days' and current_date then 5 else 0 end+
  case when v.agency is not null and length(v.agency)>1 then 3 else 0 end+
  case when v.notice_type is not null then 2 else 0 end+
  case when v.source_url like 'https://%' then 2 else 0 end+
  case when v.naics_code is not null and length(v.naics_code)>3 then 1 else 0 end+
  case when v.requested_keyword<>'' and v.title ilike '%'||v.requested_keyword||'%' then 6 else 0 end
  -- Missing scope and worksite details reduce confidence; an agency office city is not
  -- proof of a project worksite. Do not award an 85+ score for a bare title and agency.
  - case when v.city is null or trim(v.city)='' then 8 else 0 end
  - case when v.description is null or length(trim(v.description))<50 then 5 else 0 end
  - case when v.naics_code is null or length(trim(v.naics_code))<4 then 2 else 0 end
  -- Supply tenders and professional services should not score as outstanding trades work
  -- simply because the generated title category matches.
  - case when v.title ~* '(chemicals?|purchas(e|ing)|suppl(y|ies)|equipment rental|training systems?|parts for|subscriptions?|bulk materials?)'
        and v.title !~* '(install|construct|replacement|repair|maintenance|servic(e|es)|renovat)' then 17 else 0 end
  - case when v.title ~* '(design|engineer|consult|planning study|architect)' 
        and v.title !~* '(install|construct|replacement|repair|renovat)' then 9 else 0 end
  + case when v.title ~* '(install|construct|replacement|repair|renovat|rehabilitat|upgrade|maintenance|improvement)' then 4 else 0 end
 ))::integer as engine_score,
 case when v.description is not null and length(trim(v.description))>=80 and coalesce(v.city,'')<>'' then 'detailed'
      when (v.description is not null and length(trim(v.description))>=50) or coalesce(v.city,'')<>'' then 'partial'
      else 'limited' end as evidence_quality,
 case when v.title ~* '(chemicals?|purchas(e|ing)|suppl(y|ies)|equipment rental|training systems?|parts for|subscriptions?|bulk materials?)'
       and v.title !~* '(install|construct|replacement|repair|maintenance|servic(e|es)|renovat)' then 'Supplies / purchasing'
      when v.title ~* '(design|engineer|consult|planning study|architect)'
       and v.title !~* '(install|construct|replacement|repair|renovat)' then 'Design / consulting'
      when v.title ~* '(install|construct|replacement|repair|renovat|rehabilitat|upgrade|maintenance|improvement)' then 'On-site trade work'
      else 'Scope needs review' end as scope_category
 from visible v
 )
 select (to_jsonb(scored)
  - 'business_trade' - 'business_city' - 'business_state' - 'requested_trade' - 'requested_keyword' - 'target_city')
   || jsonb_build_object('search_total',count(*) over())
 from scored
 order by engine_score desc, posted_date desc nulls last, due_date asc nulls last, id desc
 limit (select max_rows from params) offset (select offset_rows from params);
$function$

REVOKE ALL ON FUNCTION public.scout_member_ranked_search(text,text,text,text,integer,integer,integer,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.scout_member_ranked_search(text,text,text,text,integer,integer,integer,text,boolean) TO authenticated,service_role;
