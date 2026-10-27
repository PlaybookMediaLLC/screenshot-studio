-- The first verified connection creates its set in the completion transaction.
-- Legacy grants keep their target and reconnect behavior, including Slack grants.
ALTER TABLE social_oauth_start
    ADD COLUMN operation text NOT NULL DEFAULT 'ADD_ACCOUNT',
    ADD COLUMN "creationVisibility" text NOT NULL DEFAULT '',
    ADD COLUMN "createdSocialSetId" text;

UPDATE social_oauth_start SET operation='RECONNECT' WHERE "expectedConnectionId" IS NOT NULL;

ALTER TABLE social_oauth_start
    ADD CONSTRAINT social_oauth_operation CHECK (operation IN ('CREATE_SET','ADD_ACCOUNT','RECONNECT')),
    ADD CONSTRAINT social_oauth_creation_target CHECK (
        (operation='CREATE_SET' AND "creationVisibility" IN ('PRIVATE','WORKSPACE')
            AND "socialSetId" IS NULL AND "expectedConnectionId" IS NULL)
        OR (operation<>'CREATE_SET' AND "creationVisibility"='' AND "createdSocialSetId" IS NULL)
    ),
    ADD CONSTRAINT social_oauth_created_receipt CHECK (
        operation<>'CREATE_SET' OR
        ("exchangeStatus"='COMPLETED' AND "createdSocialSetId" IS NOT NULL) OR
        ("exchangeStatus"<>'COMPLETED' AND "createdSocialSetId" IS NULL)
    );
