-- Clips cut into frames in the owner's browser are uploaded with their
-- manifest.json, so the bucket must accept JSON as well as images and video.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
                                  'video/mp4', 'video/quicktime', 'video/webm', 'application/json']
 where id = 'story-media';
