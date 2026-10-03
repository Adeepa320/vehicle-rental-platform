-- Executed by the postgres image on first initialisation only.
-- Creates a separate database for automated tests so they never touch dev data.
-- Extensions are NOT created here: migrations own them (so every environment,
-- including managed Postgres, gets them the same way).
CREATE DATABASE vehicle_rental_test;
