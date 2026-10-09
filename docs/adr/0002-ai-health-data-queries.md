# Limit AI health-data sharing to user-initiated queries

The iOS app syncs only user-selected Apple Health data to the self-hosted server. AI may query relevant synced health data and cardio-test history only in response to an explicit user request, sending only the relevant subset to the configured AI provider; AI returns summaries and suggestions but does not automatically share data or modify programs and records. This uses the existing provider integration while keeping health-data disclosure bounded to each query.
