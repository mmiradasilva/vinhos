-- Sign in with Google §6
CREATE TABLE app_user (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub        text NOT NULL UNIQUE,
  email             text NOT NULL,
  display_name      text,
  terms_accepted_at timestamptz NOT NULL,
  terms_version     text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          text NOT NULL UNIQUE,
  user_id             uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  csrf_token          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  cookie_refreshed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_idx ON session (user_id);
CREATE INDEX session_expires_idx ON session (expires_at);

-- Add a wine §6: system-managed lookups
CREATE TABLE colour (
  id   smallint PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE bottle_size (
  id        smallint PRIMARY KEY,
  volume_ml integer NOT NULL UNIQUE,
  name      text NOT NULL
);

CREATE TABLE country (
  id       smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  iso_code char(2) NOT NULL UNIQUE,
  name     text NOT NULL
);

-- Add a wine §6: shared lookups (BR-12, BR-14)
CREATE TABLE region (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id smallint NOT NULL REFERENCES country (id),
  name       text NOT NULL,
  name_norm  text NOT NULL,
  created_by uuid REFERENCES app_user (id) ON DELETE SET NULL,
  is_public  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX region_name_uq ON region (country_id, lower(name));

CREATE TABLE producer (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  name_norm  text NOT NULL,
  country_id smallint REFERENCES country (id),
  region_id  uuid REFERENCES region (id),
  created_by uuid REFERENCES app_user (id) ON DELETE SET NULL,
  is_public  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX producer_name_uq ON producer (lower(name), country_id) NULLS NOT DISTINCT;

CREATE TABLE grape (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  name_norm  text NOT NULL,
  created_by uuid REFERENCES app_user (id) ON DELETE SET NULL,
  is_public  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX grape_name_uq ON grape (lower(name));

-- Add a wine §6: the wine itself
CREATE TABLE wine (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  producer_id      uuid NOT NULL REFERENCES producer (id),
  name             text NOT NULL,
  name_norm        text NOT NULL,
  vintage          smallint,
  is_non_vintage   boolean NOT NULL DEFAULT false,
  colour_id        smallint NOT NULL REFERENCES colour (id),
  bottle_size_id   smallint NOT NULL REFERENCES bottle_size (id),
  quantity         integer NOT NULL CHECK (quantity BETWEEN 0 AND 9999),
  country_id       smallint REFERENCES country (id),
  region_id        uuid REFERENCES region (id),
  purchase_price   numeric(10, 2) CHECK (purchase_price >= 0),
  currency         char(3),
  purchase_date    date,
  storage_location text,
  drink_from       smallint,
  drink_until      smallint,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wine_vintage_xor_nv CHECK (is_non_vintage = (vintage IS NULL))
);
-- BR-6: NV wines (vintage NULL) must count as the same vintage.
CREATE UNIQUE INDEX wine_duplicate_uq ON wine (owner_id, producer_id, lower(name), vintage, bottle_size_id) NULLS NOT DISTINCT;
CREATE INDEX wine_owner_created_idx ON wine (owner_id, created_at DESC, id DESC);

CREATE TABLE wine_grape (
  wine_id    uuid NOT NULL REFERENCES wine (id) ON DELETE CASCADE,
  grape_id   uuid NOT NULL REFERENCES grape (id),
  percentage smallint CHECK (percentage BETWEEN 1 AND 100),
  PRIMARY KEY (wine_id, grape_id)
);
CREATE INDEX wine_grape_grape_idx ON wine_grape (grape_id);

-- Add a wine FR-9: one wine per Idempotency-Key
CREATE TABLE idempotency_key (
  user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  key         text NOT NULL,
  status_code integer,
  body        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
