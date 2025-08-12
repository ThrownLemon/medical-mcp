PBS API Public v3 integration tasks

- [x] Baseline PBS utilities
  - [x] Add `resolveLatestScheduleCode()` to fetch latest `schedule_code`
  - [x] Add `getItemByCode(pbsCode, scheduleCode?)` to fetch a single item

- [x] Extend parameter whitelist for PBS endpoints in `src/index.ts`
  - [x] `restrictions`, `item-restriction-relationships`, `restriction-prescribing-text-relationships`, `prescribing-texts`
  - [x] `prescribers`, `item-atc-relationships`, `atc-codes`, `amt-items`
  - [x] `copayments`, `item-pricing-events`, `programs`, `program-dispensing-rules`, `summary-of-changes`

- [x] New PBS tools
  - [x] `pbs-get-restrictions-for-item`
  - [x] `pbs-get-prescribers-for-item`
  - [x] `pbs-get-atc-for-item`
  - [x] `pbs-get-amt-mapping`
  - [x] `pbs-get-copayments`
  - [x] `pbs-get-organisation-for-item`
  - [x] `pbs-get-price-events-for-item`
  - [x] `pbs-get-program-details`

- [x] Optional follow-ups
  - [x] `pbs-summary-of-changes` (compare schedules for changed endpoints)
  - [x] Add memoization/caching for composed lookups to reduce API calls
  - [x] Improve rich formatting for restriction sections (indentation/labels)
  - [x] README updates for new tools and usage examples

Notes
- We respect PBS global rate limiting via existing `pbsGet` min-interval gate. Complex tools chain queries; callers should expect slower responses.
- We use the public v3 docs as source-of-truth; WADL is treated only as a reference.

