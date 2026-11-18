# Activity images (ITN-12, GEN-08, ITN-21)

## API

| Method | Route | Result |
| --- | --- | --- |
| POST | /api/activities/:id/images | Multipart `file`; 201 updated itinerary |
| DELETE | /api/activities/:id/images/:imageId | 200 updated itinerary |
| GET | /api/activities/:id/images/:imageId | Owner-authorized image bytes |
| GET | /api/itineraries/public/:itineraryId/activities/:id/images/:imageId | Guest-readable only while the itinerary and author are publicly visible |

Authoring and private reads require an active traveler session, ownership and completion of any mandatory password change. Foreign/missing resources return 404. IDs are validated; unknown multipart fields are rejected. Responses use no-store; image responses use the content-derived MIME type and nosniff. Activity views expose `{ id, url }[]`; old records without images return an empty array.

Uploads reuse MK's `ImageUpload` interceptor and `MediaService`: JPG/PNG content signatures, at most 5 MB and five images per activity. Filenames and client MIME types do not determine the file type. Oversized uploads return 413, invalid/missing files 400, the image cap or concurrent saves 409. Optimistic itinerary saves prevent parallel uploads exceeding the cap; losing uploads remove their new file.

## Privacy and lifecycle

The existing media implementation is configured with a dedicated `activities` subdirectory under `MEDIA_UPLOAD_DIR` (default `uploads`). Its generic public `/api/media/:id` route cannot serve these files. No MK media source or shared contract was changed. The stored private metadata URL is replaced with an access-appropriate URL in every owner/public itinerary view.

Private bytes require activity ownership. Public reads recheck current visibility, moderationHidden, author status and image membership. Making the itinerary private, hiding it through administration or deactivating its author removes public access on the next request. Suspended authors' public content remains visible under ACC-16. A guessed image UUID grants no private access.

Cloning copies every image to a new independently stored UUID and maps it to the new activity's private URL. Source edits, visibility and deletion cannot break existing clones. Failed copy/save removes newly copied files and creates no incomplete clone. Missing source media returns a sanitized 503.

Image/activity/day/owner-itinerary deletion removes the metadata first, then cleans the corresponding files after the successful database write. Save failure retains existing files and metadata. Filesystem cleanup is best effort; a process crash after the database commit may leave an inaccessible orphan file. MK's direct admin itinerary deletion also makes files inaccessible immediately but does not run owner-file cleanup. No durable cleanup worker or teammate moderation implementation was added.

## Demo and verification

Log in as the itinerary owner, create an activity, and use Swagger's multipart file picker on POST images. Read the returned owner URL. Publish the itinerary and read its public view to obtain the guest URL. Make it private and verify the guest URL returns 404. Clone a public source as a second traveler and verify the clone retains its own image after source deletion.

`activity-images.e2e-spec.ts` uses actual itinerary/community/auth/media modules, a disposable MongoDB replica set and an explicitly owned temporary media directory. Cases cover formats/limits, permissions, concurrent uploads, private/public access, real admin hiding, author status, independent clones, file cleanup and injected database/copy failures, legacy records and Swagger. No private environment file, external service or shared data is used.
