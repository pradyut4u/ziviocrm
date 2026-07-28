-- Drop unused Phase 1 CRM tables to keep database clean
DROP TABLE IF EXISTS public.opportunities CASCADE;
DROP TABLE IF EXISTS public.lead_qualification CASCADE;
DROP TABLE IF EXISTS public.crm_leads CASCADE;
DROP TABLE IF EXISTS public.customer_sites CASCADE;
DROP TABLE IF EXISTS public.contacts CASCADE;
DROP TABLE IF EXISTS public.account_addresses CASCADE;
DROP TABLE IF EXISTS public.accounts CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.roles CASCADE;

DROP FUNCTION IF EXISTS public.next_account_number CASCADE;
DROP FUNCTION IF EXISTS public.next_crm_lead_number CASCADE;
DROP FUNCTION IF EXISTS public.next_opportunity_number CASCADE;

DROP SEQUENCE IF EXISTS public.seq_account_number CASCADE;
DROP SEQUENCE IF EXISTS public.seq_crm_lead_number CASCADE;
DROP SEQUENCE IF EXISTS public.seq_opportunity_number CASCADE;
