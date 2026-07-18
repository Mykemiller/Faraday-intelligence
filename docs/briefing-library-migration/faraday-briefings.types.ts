// Types for the Supabase Briefing Library (faraday_briefings + link tables).
// Copy into the engine repo (v0-faraday-daily-challenge) when wiring the UI/API
// to Supabase per docs/briefing-library-migration/README.md.

export type BriefingStatus = 'Live' | 'Draft' | 'Coming Soon' | 'Retired';

export interface FaradayBriefing {
  briefing_id: number;            // stable public id (ex-Airtable autonumber)
  airtable_record_id: string;     // provenance only
  title: string;
  description: string | null;
  status: BriefingStatus;
  gamma_url: string | null;
  gamma_id: string | null;
  canonical_flag: string | null;  // 'Placeholder' on migrated Coming Soon stubs
  download_count: number;
  go_live_date: string | null;    // ISO date
  attachments: unknown[];         // jsonb; empty on all migrated rows
  unmapped_links: {
    subdomains?: string[];        // e.g. 'Jurisdiction Posture Intelligence (JPS)'
    themes?: string[];            // e.g. 'The Rack Revolution'
    companies?: { id: string; name: string }[];
  };
  airtable_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FaradayBriefingDomainLink { briefing_id: number; domain_code: string }      // -> faraday_domains
export interface FaradayBriefingSubdomainLink { briefing_id: number; subdomain_code: string } // -> faraday_subdomains
export interface FaradayBriefingCompanyLink { briefing_id: number; company_id: string }       // -> tracking_companies
export interface FaradayBriefingThemeLink { briefing_id: number; theme_code: string }         // -> faraday_themes

// Shape returned by the recommended nested select (see README §Code-update spec).
export interface FaradayBriefingWithLinks extends FaradayBriefing {
  faraday_briefing_domains: FaradayBriefingDomainLink[];
  faraday_briefing_subdomains: FaradayBriefingSubdomainLink[];
  faraday_briefing_companies: FaradayBriefingCompanyLink[];
  faraday_briefing_themes: FaradayBriefingThemeLink[];
}
