# Privacy

This note is for the University of San Carlos Data Privacy Officer. It says where REC-DMS keeps personal data. It is not a privacy notice for research participants. Participant information inside an uploaded protocol is the researcher’s submission and is stored with that protocol.

## What is stored

| Data | Where | Region |
| --- | --- | --- |
| Accounts, protocols, forms, signatures metadata, audit log, jobs | Supabase Postgres, schema `recdms` | Singapore |
| Uploaded manuscripts, receipts, generated DOCX and PDF, signature images | Supabase Storage, private bucket `recdms-files` | Singapore |
| Password hashes | Supabase Postgres, on the user row | Singapore |
| Authenticator secret | Supabase Postgres, encrypted with the application secret before it is stored | Singapore |
| Email in transit | The configured mail provider (Mailpit on a workstation, Resend or SMTP in production) | The provider’s region. Prefer a provider that can send from or store in Singapore, and record the choice here when it is picked. |
| PDF conversion | The filled DOCX is sent over HTTPS to Gotenberg on Cloud Run for conversion and is not retained by that service after the response | Singapore (`asia-southeast1`) |
| Virus scan | The file bytes are sent over HTTPS to ClamAV on Cloud Run. The service does not store the file | Singapore |
| Off-site copy | Nightly `pg_dump` and a mirror of the file bucket in a private Cloud Storage bucket | Singapore |
| Application logs | Vercel function logs, and Sentry only if `SENTRY_DSN` is set | Vercel functions run in Singapore (`sin1`). Sentry’s region is the project setting. Leave `SENTRY_DSN` empty until that project is in an acceptable region. |
| Session | Encrypted cookie in the browser | The person’s device |

The development Supabase project (`jrgsxhcegqstegpqgbyv`) is for building the system. Do not load real protocol files into it.

## Access

A protocol is visible to its members, assigned reviewers, the panel chair, the REC Chair, REC Staff, and system administrators. Every mutation checks `authorize`. Downloads of clean files use a URL that expires in five minutes. Infected files are removed from storage.

A person can download their own profile, email addresses, memberships, and signature list as JSON from Account → Your data (`GET /api/account/export`). The file does not include other people’s data or protocol documents.

Deletion of a closed protocol is a decision for REC Staff. The weekly job flags protocols whose status is one of Approved, Exempted, Disapproved, Lapsed, or Withdrawn and whose last update is older than `retention.policy` (default 3 years). It does not delete them. The list is at `/admin/retention`.

## Encryption

TLS on the browser connection, on the database connection (`sslmode=require`), and on the calls to storage, Gotenberg, and ClamAV. Supabase and Cloud Storage encrypt disks at rest. The backup bucket blocks public access.

## Subprocessors to name in the USC record

- Vercel (application hosting, Singapore functions)
- Supabase (Postgres and object storage, Singapore)
- Google Cloud (Cloud Run, Cloud Scheduler, Cloud Storage, Secret Manager, Singapore)
- The email provider, once chosen
- Sentry, only if the DSN is set
