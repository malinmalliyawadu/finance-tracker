-- Passkeys. Public keys only, and no user table.
--
-- This is a single-household app: there is one password, and a passkey is an
-- easier way to present the same fact. So a row here is a device, not a person,
-- and there is nothing to join it to. Adding a users table to hang these off
-- would invent an identity model the app does not have and cannot check.
--
-- The password stays the root of trust. Registration is only allowed to someone
-- already signed in, so every row descends from someone who knew the password,
-- and changing the password does not revoke these — it revokes the sessions
-- that could have created them. Deleting a passkey is a row deletion, which is
-- why the label matters: it is the only thing distinguishing two rows a year
-- from now.

create table passkeys (
  -- The credential id as the authenticator gave it, base64url. Natural key: it
  -- is what an assertion names, and it is unique by construction.
  credential_id text primary key,

  -- The COSE public key. Verifying a signature is all this is ever used for, so
  -- a leak of this table leaks nothing that can sign anything.
  public_key    bytea not null,

  -- Authenticators that keep one increment the counter on every assertion; a
  -- counter that goes backwards means two things are answering for one
  -- credential. Persisted after each success or the check means nothing.
  counter       bigint not null default 0,

  -- usb, nfc, ble, internal, hybrid — a hint the browser uses to offer the
  -- right prompt. Advisory, so no constraint on the contents.
  transports    text[] not null default '{}',

  -- Typed by whoever registered it. Not derived from the user agent: "Chrome on
  -- macOS" is three identical rows on one desk, and the useful name is the one
  -- they would say out loud when deciding which to delete.
  label         text not null,

  -- singleDevice or multiDevice, and whether the credential is currently backed
  -- up to a keychain. Shown, not enforced: it is the difference between "losing
  -- this laptop loses this passkey" and "it is in iCloud".
  device_type   text not null,
  backed_up     boolean not null default false,

  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,

  constraint passkeys_label_not_blank check (btrim(label) <> '')
);

comment on table passkeys is
  'Registered WebAuthn credentials. Public keys only; a row is a device, not a person. The shared password is the root of trust and every row here descends from someone who knew it.';

comment on column passkeys.counter is
  'Signature counter from the last accepted assertion. Not all authenticators keep one, in which case it stays 0 and the clone check is inert.';

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------

-- Registering and signing in both happen in the Next.js server, which is
-- finance_web. It writes rows because a human added a device from the UI, which
-- is the same reason it may write rules and overrides.
grant select, insert, update, delete on passkeys to finance_web;

-- 0004 grants select on future tables to both roles so a new table is never
-- invisible to the app. That default is wrong exactly here: the sync job
-- fetches transactions and has no business reading credentials, however inert
-- a public key is.
revoke all on passkeys from finance_sync;
