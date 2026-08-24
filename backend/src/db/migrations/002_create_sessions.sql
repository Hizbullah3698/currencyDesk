-- Standard connect-pg-simple table shape, tracked as a real migration (rather than left to
-- the library's auto-create-on-boot option) so it's reviewable and versioned like everything
-- else in this directory.
CREATE TABLE session (
  sid    varchar NOT NULL COLLATE "default" PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX "IDX_session_expire" ON session (expire);
