# AI Talent Studio

Human-governed candidate sourcing workspace.

## V1 scope

Role Brief -> Calibration Round 1 -> Feedback Round 1 -> Calibration Round 2 -> Feedback Round 2 -> Locked Sourcing Profile -> Candidate Market Map -> Evidence Check -> Production.

Production batches are user-triggered, contain up to 30 net-new candidates, and can be started repeatedly while quality remains acceptable.

V1 intentionally excludes ATS integration and outbound campaign execution.

## Stack

- Frontend: static web app
- Backend/data/auth/storage: Supabase
- Repository: GitHub
- Server-side research/orchestration: Supabase Edge Functions

## Supabase project

Project ref: `dxtvsavrezicbucysrdy`

Do not commit secret API keys or service-role keys. Browser code may only use a Supabase publishable key.

## Security

The database uses Row Level Security. Candidate uploads are stored in a private bucket and scoped by authenticated user ID.

## Next build steps

1. Migrate the current Talent Studio frontend into this repository.
2. Add Supabase Auth and persistent search state.
3. Replace local mock state with database-backed state.
4. Implement George as a context-aware copilot backed by Edge Functions.
5. Add calibration, market-map, evidence and production research functions.
6. Add deployment and end-to-end tests.
