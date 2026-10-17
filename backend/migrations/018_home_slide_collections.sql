ALTER TABLE home_slides
  ADD COLUMN title text NOT NULL DEFAULT '',
  ADD COLUMN caption text NOT NULL DEFAULT '',
  ADD COLUMN collection text NOT NULL DEFAULT '';
