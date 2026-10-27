-- A content draft written as a thread posts its later posts as replies on X
-- (RFC 013): each reply's caption and image ids, in order.
ALTER TABLE "scheduled_post" ADD COLUMN "replies" JSONB;
