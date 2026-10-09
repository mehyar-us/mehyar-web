# Chat photo retention policy (Crew 6j)

Photos attached in the chat composer are the **business's data**. This document
is the policy of record for how The Mayor stores, scopes, and deletes them.

## Storage

- Photos live in the `mayor_chat_images` D1 table (migration `0061_mayor_chat_images.sql`).
  There is no R2 binding on this worker; D1 is the repo's existing
  tenant-scoped store (the same one backing auth grants, missed calls, and
  SMS logs).
- The client downscales every photo to a max 1280px edge (JPEG ~0.82) before
  upload, so stored photos are typically 100–400 KB. The server rejects
  anything over 5 MB and anything that isn't JPEG/PNG/WebP.

## Tenant scoping

- Every row carries `tenant_id`. Every read, fetch, and delete filters on
  `tenant_id = ?` — a photo id from another business resolves to nothing.
- Photos are never shared across businesses, never used for training, and
  never leave the request path except to the vision model for the turn that
  references them.

## Retention

- **90 days.** Photos are kept with the conversation for 90 days from upload,
  then deleted. Deletion is enforced opportunistically on every upload
  (`DELETE ... WHERE tenant_id=? AND created_at < now - 90d`); no scheduler
  is required.
- **Owner delete any time:** the composer offers remove-before-send, and
  `POST .../conversation/images/delete {id}` deletes a stored photo
  immediately (tenant-scoped).
- Photos are business records, not marketing assets: they are never published,
  never attached to outbound messages, and never shown to other businesses.

## What the model may do with a photo

- The attached photo is analyzed once, in the turn that references it, by the
  vision model. The observation is appended to that turn's user message only;
  it is not written into the business profile or long-term memory.
- Honesty rule (hard): the model must never invent what it cannot see. When
  the photo is unclear or the question can't be answered from it, it says so
  plainly and asks for a clearer photo.

## Data-deletion requests

A deletion request (in-app or via `info@mehyar.us`, per the data-deletion
page) covers chat photos the same as any other business data: the tenant's
rows are deleted.
