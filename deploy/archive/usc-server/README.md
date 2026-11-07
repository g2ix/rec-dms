# Archived USC server stack

This compose file was the earlier plan: Postgres, MinIO, Gotenberg, and Mailpit on a USC machine, reached through a tunnel.

That path is not the deployment. The app runs on Vercel in Singapore. The database and files are Supabase in Singapore. PDF conversion and virus scanning run on Google Cloud Run in Singapore. Schedules are Cloud Scheduler. Backups go to a private Cloud Storage bucket.

Do not start this compose file for production. Local development does not use Docker. See `docs/DEPLOY.md`.
