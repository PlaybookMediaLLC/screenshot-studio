-- Prohibited terms become objects: {"term", "matchMode", "reason"?}. A legacy
-- string becomes a word-mode term with no reason.
UPDATE "brand_profile"
SET "prohibitedTerms" = (
    SELECT COALESCE(jsonb_agg(
        CASE WHEN jsonb_typeof(term) = 'string'
            THEN jsonb_build_object('term', term #>> '{}', 'matchMode', 'word')
            ELSE term
        END ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements("prohibitedTerms") WITH ORDINALITY AS terms(term, position)
)
WHERE jsonb_typeof("prohibitedTerms") = 'array';
