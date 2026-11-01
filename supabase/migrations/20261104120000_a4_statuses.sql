-- A4: two new make statuses, in their own migration so the next one can use them.
--   retake     the coach couldn't see the work well enough; the teen can take it again
--   no_review  the coach couldn't finish a review; the teen gets a lesson instead
alter type public.make_status add value if not exists 'retake';
alter type public.make_status add value if not exists 'no_review';
